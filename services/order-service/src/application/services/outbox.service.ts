import { Inject, Injectable, Logger } from '@nestjs/common';

import { OrderStatus } from '../../domain/order-status';
import { OrderRepository } from '../ports/order.repository';
import {
  OutboxMessageRecord,
  OutboxRepository,
  OutboxStatus,
  OutboxTopic,
} from '../ports/outbox.repository';
import { ORDER_TOKENS } from '../tokens';

export interface OutboxSweepResult {
  claimed: number;
  delivered: number;
  failed: number;
  /** Rows that ran out of retries on this pass — somebody has to look at these. */
  dead: number;
  /**
   * J7: false when the round claimed work and delivered none of it.
   *
   * These counters were already honest; nothing read them. `sweep.sh` saw HTTP 200 and
   * refreshed the scheduler heartbeat, so `{"claimed":50,"delivered":0,"failed":50}` —
   * every owed stock consume, loyalty award and franchise credit failing, every ten
   * minutes — looked exactly like `{"claimed":0,...}`, a quiet backlog-free tick.
   *
   * True while any row got through: a partial failure is a retry, and pinning the
   * scheduler to unhealthy for one bad row hides the next real outage.
   */
  ok: boolean;
}

/** Runs one effect for one order. Registered by OrderService, which owns the adapters. */
export type OutboxHandler = (orderId: string, authorization: string) => Promise<void>;

@Injectable()
export class OutboxService {
  private static readonly BATCH = 50;
  /** Six tries ≈ 1m, 2m, 4m, 8m, 16m, 32m — about an hour of downstream outage absorbed. */
  private static readonly MAX_ATTEMPTS = 6;
  private static readonly BASE_BACKOFF_MS = 60_000;

  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<OutboxTopic, OutboxHandler>();

  constructor(
    @Inject(ORDER_TOKENS.OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(ORDER_TOKENS.OrderRepository) private readonly orders: OrderRepository,
  ) {}

  /**
   * Wires a topic to the code that performs it.
   *
   * Registration rather than a switch on OrderService: the handlers all live there (it
   * owns the adapters and the franchise-owner lookup), and a dispatcher that imported it
   * would close a cycle — OrderService already enqueues through this class.
   */
  register(topic: OutboxTopic, handler: OutboxHandler): void {
    this.handlers.set(topic, handler);
  }

  /**
   * Delivers everything due. Admin/ops-triggered on a schedule, mirroring expireAbandoned
   * and the subscription sweep — this repo runs no cron daemon of its own.
   *
   * Every handler is idempotent on the receiving side (keyed by order id), so a redelivery
   * costs a wasted call, never a double consume or a double credit. That is what makes it
   * safe for two sweeps to overlap, and why no lock is taken. B10: the repository method
   * used to be called `claimDue`, which promised one — it is `findDue` now, because a name
   * that lies is how the next person builds on a guarantee nobody ever made.
   */
  async processDue(now: Date = new Date()): Promise<OutboxSweepResult> {
    // The sweep carries no caller token: these adapters authenticate service-to-service
    // with the internal key, which is what lets a retry hours later still land.
    return this.run(await this.outbox.findDue(now, OutboxService.BATCH), '', now);
  }

  /**
   * Delivers what one order owes, right now, on the request that earned it.
   *
   * The happy path stays as immediate as it was before the outbox existed; the difference
   * is that a failure here leaves a PENDING row for the sweep instead of a log line.
   */
  /**
   * C3: the order stopped owing what it owed. Answers how many rows were still due, so the
   * caller can log a number rather than a hope.
   */
  async cancelForOrder(orderId: string, reason: string): Promise<number> {
    const cancelled = await this.outbox.cancelForOrder(orderId, reason);
    if (cancelled > 0) {
      this.logger.log(`Outbox: ${cancelled} baris dibatalkan untuk order ${orderId} — ${reason}`);
    }
    return cancelled;
  }

  async processForOrder(orderId: string, authorization: string): Promise<OutboxSweepResult> {
    const now = new Date();
    const due = (await this.outbox.findDue(now, OutboxService.BATCH)).filter(
      (m) => m.orderId === orderId,
    );
    return this.run(due, authorization, now);
  }

  private async run(
    due: OutboxMessageRecord[],
    authorization: string,
    now: Date,
  ): Promise<OutboxSweepResult> {
    const result: OutboxSweepResult = {
      claimed: due.length,
      delivered: 0,
      failed: 0,
      dead: 0,
      ok: true,
    };

    for (const message of due) {
      try {
        await this.deliver(message, authorization);
        await this.outbox.markDone(message.id);
        result.delivered += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const retryAt = this.nextAttemptFor(message, now);
        await this.outbox.markFailed(message.id, reason, retryAt);
        result.failed += 1;
        if (!retryAt) {
          result.dead += 1;
          // Loud on purpose: this is a completed order whose stock was never consumed, or
          // whose owner was never credited, and no further attempt is coming.
          this.logger.error(
            `Outbox ${message.topic} for order ${message.orderId} gave up after ${message.attempts + 1} attempts: ${reason}`,
          );
        }
      }
    }
    if (result.claimed > 0) {
      this.logger.log(
        `Outbox sweep: ${result.delivered} delivered, ${result.failed} failed, ${result.dead} dead`,
      );
    }
    result.ok = result.failed === 0 || result.delivered > 0;
    return result;
  }

  /** What is still owed, for the ops view. */
  pending(): Promise<Record<OutboxStatus, number>> {
    return this.outbox.countByStatus();
  }

  private async deliver(message: OutboxMessageRecord, authorization: string): Promise<void> {
    const handler = this.handlers.get(message.topic);
    if (!handler) {
      // An unknown topic is a deploy that rolled back the code but not the rows. Retrying
      // is right — the next release brings the handler back and the effect still lands.
      throw new Error(`No handler registered for topic ${message.topic}`);
    }
    // A row whose order has since been deleted owes nothing; treat it as delivered rather
    // than retrying it to death.
    const order = await this.orders.findById(message.orderId);
    if (!order) return;
    /*
     * C3: nor does an order that stopped being a sale.
     *
     * This block asked whether the order still EXISTS and never what state it was in, so a
     * voided counter sale kept its PENDING rows and the sweep ran them minutes later: the
     * stock the void had just handed back was consumed again, the points it had just
     * reversed were awarded again, and the franchise owner was credited again for money
     * returned over the counter. Measured in `void-cancels-outbox.spec.ts` before this
     * line existed.
     *
     * The void also cancels the rows outright, which is the cheaper half. This is the
     * other half: a row a sweep was already holding when the void landed cannot be called
     * back, so the handler has to refuse it here.
     */
    if (order.status === OrderStatus.VOIDED || order.status === OrderStatus.CANCELLED) return;
    await handler(message.orderId, authorization);
  }

  private nextAttemptFor(message: OutboxMessageRecord, now: Date): Date | null {
    const attempts = message.attempts + 1;
    if (attempts >= OutboxService.MAX_ATTEMPTS) return null;
    return new Date(now.getTime() + OutboxService.BASE_BACKOFF_MS * 2 ** (attempts - 1));
  }
}
