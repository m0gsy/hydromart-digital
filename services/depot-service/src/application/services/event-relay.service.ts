import { Inject, Injectable, Logger } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import { EventOutboxRecord, EventOutboxRepository } from '../ports/event-outbox.repository';
import { EventPublisherPort } from '../ports/event-publisher.port';
import { DEPOT_TOKENS } from '../tokens';

export interface EventRelaySweepResult {
  claimed: number;
  delivered: number;
  failed: number;
  /** Rows that ran out of retries on this pass: somebody has to look at these. */
  dead: number;
  /** DONE rows older than the retention window that this pass deleted. */
  pruned: number;
  /** False when the round had work and got none of it through (same rule as the J7 sweeps). */
  ok: boolean;
}

/**
 * HD-7: sends depot-service's webhook events to admin-service, through the outbox.
 *
 * The same machinery as delivery-service's AAS-11 relay. The outbox row is written by the
 * transaction that owes it (a franchise application and its event commit together), `flush`
 * sends it once straight away, and the sweep re-sends whatever admin-service has not taken. A
 * repeat is harmless: admin-service queues one delivery per endpoint per eventId.
 */
@Injectable()
export class EventRelayService {
  private static readonly BATCH = 50;
  /** Six tries ≈ 1m, 2m, 4m, 8m, 16m, 32m: about an hour of admin-service outage absorbed. */
  private static readonly MAX_ATTEMPTS = 6;
  private static readonly BASE_BACKOFF_MS = 60_000;
  /** How long a DONE row is kept as a record that the event went out. */
  private static readonly KEEP_DONE_MS = 7 * 86_400_000;
  private static readonly PRUNE_BATCH = 500;

  private readonly logger = new Logger(EventRelayService.name);

  constructor(
    @Inject(DEPOT_TOKENS.EventOutbox) private readonly outbox: EventOutboxRepository,
    @Inject(DEPOT_TOKENS.EventTransport) private readonly transport: EventPublisherPort,
  ) {}

  /**
   * Sends one recorded event now, if it is still owed. Never throws: what it reports is already
   * saved, and the person who caused it (an applicant on /waralaba) must not see an
   * admin-service outage. Whatever is not sent here, the sweep sends.
   */
  async flush(eventId: string): Promise<void> {
    try {
      const row = await this.outbox.findByEventId(eventId);
      if (row?.status === 'PENDING') await this.attempt(row, new Date());
    } catch (error) {
      this.logger.warn(`${eventId} left for the sweep: ${(error as Error).message}`);
    }
  }

  /** Re-sends everything due. Driven by the scheduler; safe to overlap (admin dedupes). */
  async processDue(now: Date = new Date()): Promise<EventRelaySweepResult> {
    const due = await this.outbox.findDue(now, EventRelayService.BATCH);
    const result: EventRelaySweepResult = {
      claimed: due.length,
      delivered: 0,
      failed: 0,
      dead: 0,
      pruned: 0,
      ok: true,
    };
    for (const row of due) {
      const outcome = await this.attempt(row, now);
      if (outcome === 'delivered') result.delivered += 1;
      else {
        result.failed += 1;
        if (outcome === 'dead') result.dead += 1;
      }
    }
    result.ok = result.failed === 0 || result.delivered > 0;
    // Housekeeping after the real work, and never allowed to fail the sweep.
    try {
      result.pruned = await this.outbox.pruneDone(
        new Date(now.getTime() - EventRelayService.KEEP_DONE_MS),
        EventRelayService.PRUNE_BATCH,
      );
    } catch (error) {
      this.logger.warn(`outbox prune skipped: ${(error as Error).message}`);
    }
    return result;
  }

  private async attempt(
    row: EventOutboxRecord,
    now: Date,
  ): Promise<'delivered' | 'retry' | 'dead'> {
    try {
      await this.transport.publish(row.event, row.payload, row.occurredAt, row.eventId);
      await this.outbox.markDone(row.id);
      return 'delivered';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const attempts = row.attempts + 1;
      const next =
        attempts >= EventRelayService.MAX_ATTEMPTS
          ? null
          : new Date(now.getTime() + EventRelayService.BASE_BACKOFF_MS * 2 ** (attempts - 1));
      await this.outbox.markFailed(row.id, reason, next);
      if (next) {
        this.logger.warn(`${row.event} ${row.eventId} not delivered (try ${attempts}): ${reason}`);
        return 'retry';
      }
      this.logger.error(`${row.event} ${row.eventId} gave up after ${attempts} attempts: ${reason}`);
      alertServerError({
        method: 'POST',
        path: 'depot-webhook-outbox#dead',
        status: 500,
        exception: new Error(`${row.event} ${row.eventId} failed after ${attempts} attempts: ${reason}`),
      });
      return 'dead';
    }
  }
}
