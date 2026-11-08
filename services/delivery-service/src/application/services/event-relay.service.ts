import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import { EventOutboxRepository, EventOutboxRecord } from '../ports/event-outbox.repository';
import { EventPublisherPort } from '../ports/event-publisher.port';
import { DELIVERY_TOKENS } from '../tokens';

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
 * Publishes partner events through a durable outbox (AAS-11), still fail-open for the caller.
 *
 * It IS the `EventPublisherPort` the delivery service talks to. The row is recorded first
 * (for a delivery completion, by the repository INSIDE the completion transaction, so a
 * crash cannot separate the handover from the event it owes), sent once inline, and left
 * PENDING for the sweep if admin did not take it. A retry is safe because admin-service
 * dedupes on `eventId`.
 *
 * `publish` therefore means "make sure this key is sent": if the key is already recorded
 * and still PENDING it sends that row instead of recording another.
 */
@Injectable()
export class EventRelayService implements EventPublisherPort {
  private static readonly BATCH = 50;
  /** Six tries ≈ 1m, 2m, 4m, 8m, 16m, 32m: about an hour of admin-service outage absorbed. */
  private static readonly MAX_ATTEMPTS = 6;
  private static readonly BASE_BACKOFF_MS = 60_000;
  /** How long a DONE row is kept as a record that the event went out. */
  private static readonly KEEP_DONE_MS = 7 * 86_400_000;
  private static readonly PRUNE_BATCH = 500;

  private readonly logger = new Logger(EventRelayService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.EventOutbox) private readonly outbox: EventOutboxRepository,
    @Inject(DELIVERY_TOKENS.EventTransport) private readonly transport: EventPublisherPort,
  ) {}

  /** Never throws: the handover is already recorded and the courier must not feel this. */
  async publish(
    event: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
    eventId?: string,
  ): Promise<void> {
    const key = eventId ?? randomUUID();
    let row: EventOutboxRecord | null;
    try {
      row = await this.outbox.enqueue({ event, eventId: key, payload, occurredAt });
    } catch (error) {
      // Cannot even record it: fall back to the old inline attempt rather than lose it for sure.
      this.logger.error(`${event} not recorded in the outbox: ${(error as Error).message}`);
      await this.transport.publish(event, payload, occurredAt, key).catch(() => undefined);
      return;
    }
    // null = the key was already recorded (the completion transaction did it). That row owns
    // the send; if it is still PENDING, send it now rather than wait for the sweep.
    const owner = row ?? (await this.outbox.findByEventId(key));
    if (owner?.status === 'PENDING') await this.attempt(owner, new Date());
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
        path: 'webhook-outbox#dead',
        status: 500,
        exception: new Error(`${row.event} ${row.eventId} failed after ${attempts} attempts: ${reason}`),
      });
      return 'dead';
    }
  }
}
