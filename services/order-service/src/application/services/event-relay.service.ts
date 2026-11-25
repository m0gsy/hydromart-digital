import { Inject, Injectable, Logger } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import { EventOutboxRecord, EventOutboxRepository } from '../ports/event-outbox.repository';
import { EventPublisherPort } from '../ports/event-publisher.port';
import { ORDER_TOKENS } from '../tokens';

export interface EventRelaySweepResult {
  claimed: number;
  delivered: number;
  failed: number;
  /** DONE rows older than the retention window that this pass deleted. */
  pruned: number;
  /**
   * Events owed for an hour or more. Reported, not a verdict: it is in the round's body, which
   * the sweeps API (sweep_runs.detail) and the scheduler log keep; /hq/health prints a detail
   * only for a failing round.
   */
  stuck: number;
  /**
   * False when the round had work and got none of it through: the J7 rule, kept on purpose. A
   * stuck event's hourly try fails, so it pages about once an hour; pinning every round red
   * while it waits would page every 10 minutes (144 a day for one application) and teach
   * people to ignore the job.
   */
  ok: boolean;
}

/**
 * The wait after the `attempts`-th failed try: 1, 2, 4, 8, 16, 32 minutes, then an hour for as
 * long as it takes. contracts/ai-v1/events.openapi.json states the same rhythm (a test ties them).
 */
export function outboxRetryDelayMs(attempts: number): number {
  return Math.min(3_600_000, 60_000 * 2 ** Math.min(Math.max(attempts, 1) - 1, 20));
}

/** The reason behind a rejection, whatever was thrown (a null rejection has no .message). */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * HD-17B: sends order-service's webhook events (order.created, order.status_changed) to
 * admin-service, through the outbox: the same machinery as depot-service's HD-7 relay.
 *
 * The outbox row is written by the transaction that owes it (an order write or status change and
 * its event commit together); the scheduler sweep (every minute) sends it, and re-sends whatever
 * admin-service has not taken. A repeat is harmless: admin-service queues one delivery per
 * endpoint per eventId. Events are never given up: retries wait 1, 2, 4 ... 32 minutes, then an
 * hour; one alert at the 6th failure, and sweep.sh pages a round in which nothing due got through.
 *
 * Volume: a status change is an event, so ~5 per order. A round takes up to BATCH rows, oldest
 * first, and stops after MAX_CONSECUTIVE_FAILURES in a row: with admin-service down every send
 * costs its 5 s timeout, and 200 of them would outlive the next round. Failed rows back off, so
 * the next round reaches the rows behind them.
 */
@Injectable()
export class EventRelayService {
  private static readonly BATCH = 200;
  /** How long a claimed row is the claimer's: past a send's 5 s timeout, short enough to recover a dead sweep. */
  private static readonly LEASE_MS = 5 * 60_000;
  /** A round with this many failures back to back is an outage, not bad luck: stop and let it back off. */
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;
  /** The try that raises the one alert (about an hour after the event). */
  private static readonly ALERT_AT_ATTEMPT = 6;
  /** Owed for this long, an event counts as stuck in the round's report. */
  private static readonly STUCK_AFTER_MS = 3_600_000;
  /** How long a DONE row is kept as a record that the event went out. */
  private static readonly KEEP_DONE_MS = 7 * 86_400_000;
  private static readonly PRUNE_BATCH = 500;

  private readonly logger = new Logger(EventRelayService.name);

  constructor(
    @Inject(ORDER_TOKENS.EventOutbox) private readonly outbox: EventOutboxRepository,
    @Inject(ORDER_TOKENS.EventTransport) private readonly transport: EventPublisherPort,
  ) {}

  /** Re-sends everything due. Driven by the scheduler; safe to overlap (admin dedupes). */
  async processDue(now: Date = new Date()): Promise<EventRelaySweepResult> {
    const due = await this.outbox.findDue(now, EventRelayService.BATCH);
    const result: EventRelaySweepResult = {
      claimed: due.length,
      delivered: 0,
      failed: 0,
      pruned: 0,
      stuck: 0,
      ok: true,
    };
    let streak = 0;
    for (const row of due) {
      // Another sweep may hold it: skip, neither sent nor counted.
      if (!(await this.outbox.claim(row.id, now, new Date(now.getTime() + EventRelayService.LEASE_MS)))) {
        result.claimed -= 1;
        continue;
      }
      if (await this.attempt(row, now)) {
        result.delivered += 1;
        streak = 0;
      } else {
        result.failed += 1;
        streak += 1;
        if (streak >= EventRelayService.MAX_CONSECUTIVE_FAILURES) break;
      }
    }
    result.stuck = await this.outbox.countStuck(
      new Date(now.getTime() - EventRelayService.STUCK_AFTER_MS),
    );
    result.ok = result.failed === 0 || result.delivered > 0;
    // Housekeeping after the real work, and never allowed to fail the sweep.
    try {
      result.pruned = await this.outbox.pruneDone(
        new Date(now.getTime() - EventRelayService.KEEP_DONE_MS),
        EventRelayService.PRUNE_BATCH,
      );
    } catch (error) {
      this.logger.warn(`outbox prune skipped: ${reasonOf(error)}`);
    }
    return result;
  }

  /** True when admin-service took the event. */
  private async attempt(row: EventOutboxRecord, now: Date): Promise<boolean> {
    try {
      await this.transport.publish(row.event, row.payload, row.occurredAt, row.eventId);
      await this.outbox.markDone(row.id);
      return true;
    } catch (error) {
      const reason = reasonOf(error);
      const attempts = row.attempts + 1;
      await this.outbox.markFailed(
        row.id,
        reason,
        new Date(now.getTime() + outboxRetryDelayMs(attempts)),
      );
      this.logger.warn(`${row.event} ${row.eventId} not delivered (try ${attempts}): ${reason}`);
      if (attempts === EventRelayService.ALERT_AT_ATTEMPT) {
        alertServerError({
          method: 'POST',
          path: 'order-webhook-outbox#stuck',
          status: 500,
          exception: new Error(
            `${row.event} ${row.eventId} not delivered after ${attempts} tries (${reason}); ` +
              'still retrying hourly',
          ),
        });
      }
      return false;
    }
  }
}
