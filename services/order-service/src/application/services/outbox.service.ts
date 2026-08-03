import { Inject, Injectable, Logger } from '@nestjs/common';

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
   * safe for two sweeps to overlap, and why the claim does not need a lock.
   */
  async processDue(now: Date = new Date()): Promise<OutboxSweepResult> {
    // The sweep carries no caller token: these adapters authenticate service-to-service
    // with the internal key, which is what lets a retry hours later still land.
    return this.run(await this.outbox.claimDue(now, OutboxService.BATCH), '', now);
  }

  /**
   * Delivers what one order owes, right now, on the request that earned it.
   *
   * The happy path stays as immediate as it was before the outbox existed; the difference
   * is that a failure here leaves a PENDING row for the sweep instead of a log line.
   */
  async processForOrder(orderId: string, authorization: string): Promise<OutboxSweepResult> {
    const now = new Date();
    const due = (await this.outbox.claimDue(now, OutboxService.BATCH)).filter(
      (m) => m.orderId === orderId,
    );
    return this.run(due, authorization, now);
  }

  private async run(
    due: OutboxMessageRecord[],
    authorization: string,
    now: Date,
  ): Promise<OutboxSweepResult> {
    const result: OutboxSweepResult = { claimed: due.length, delivered: 0, failed: 0, dead: 0 };

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
    await handler(message.orderId, authorization);
  }

  private nextAttemptFor(message: OutboxMessageRecord, now: Date): Date | null {
    const attempts = message.attempts + 1;
    if (attempts >= OutboxService.MAX_ATTEMPTS) return null;
    return new Date(now.getTime() + OutboxService.BASE_BACKOFF_MS * 2 ** (attempts - 1));
  }
}
