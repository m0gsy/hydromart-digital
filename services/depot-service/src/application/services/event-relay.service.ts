import { Inject, Injectable, Logger } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import { EventOutboxRecord, EventOutboxRepository } from '../ports/event-outbox.repository';
import { EventPublisherPort } from '../ports/event-publisher.port';
import { DEPOT_TOKENS } from '../tokens';

export interface EventRelaySweepResult {
  claimed: number;
  delivered: number;
  failed: number;
  /** DONE rows older than the retention window that this pass deleted. */
  pruned: number;
  /**
   * Events owed for an hour or more. Reported, not a verdict: it is in the round's body, which
   * /hq/health shows beside the job.
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

/** The reason behind a rejection, whatever was thrown (a null rejection has no .message). */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * HD-7: sends depot-service's webhook events to admin-service, through the outbox.
 *
 * The same machinery as delivery-service's AAS-11 relay. The outbox row is written by the
 * transaction that owes it (a franchise application and its event commit together), `flush`
 * sends it once straight away, and the sweep re-sends whatever admin-service has not taken. A
 * repeat is harmless: admin-service queues one delivery per endpoint per eventId.
 *
 * Unlike AAS-11, an event here is never given up. A calon mitra waiting for a call back is
 * worth more than a tidy table, and every way this fails is fixed by somebody else first: an
 * admin-service outage, an INTERNAL_SERVICE_KEY that no longer matches, a release that refuses
 * the body. So the relay keeps trying, about an hour apart, and once the cause is fixed the
 * event goes through by itself, with nothing to re-queue by hand on the box. Somebody is told:
 * one alert when a single event has failed six times (about an hour), then sweep.sh pages each
 * hourly try that fails (ok:false), and every round reports how many events are stuck.
 *
 * ponytail: unbounded retries; the ceiling is one request an hour per stuck event, a handful
 * a month at today's volume. Add a give-up date if events ever arrive by the thousand.
 */
@Injectable()
export class EventRelayService {
  private static readonly BATCH = 50;
  /** 1m, 2m, 4m, 8m, 16m, 32m, then an hour between tries for as long as it takes. */
  private static readonly BASE_BACKOFF_MS = 60_000;
  private static readonly MAX_BACKOFF_MS = 3_600_000;
  /** The try that raises the one alert (about an hour after the event). */
  private static readonly ALERT_AT_ATTEMPT = 6;
  /** Owed for this long, an event counts as stuck in the round's report. */
  private static readonly STUCK_AFTER_MS = 3_600_000;
  /** How long a DONE row is kept as a record that the event went out. */
  private static readonly KEEP_DONE_MS = 7 * 86_400_000;
  private static readonly PRUNE_BATCH = 500;

  private readonly logger = new Logger(EventRelayService.name);

  constructor(
    @Inject(DEPOT_TOKENS.EventOutbox) private readonly outbox: EventOutboxRepository,
    @Inject(DEPOT_TOKENS.EventTransport) private readonly transport: EventPublisherPort,
  ) {}

  /**
   * Sends one recorded event now, if it is still owed. Never rejects: what it reports is already
   * saved, and the person who caused it (an applicant on /waralaba) must not see an
   * admin-service outage. Whatever is not sent here, the sweep sends.
   */
  async flush(eventId: string): Promise<void> {
    try {
      const row = await this.outbox.findByEventId(eventId);
      if (row?.status === 'PENDING') await this.attempt(row, new Date());
    } catch (error) {
      this.logger.warn(`${eventId} left for the sweep: ${reasonOf(error)}`);
    }
  }

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
    for (const row of due) {
      if (await this.attempt(row, now)) result.delivered += 1;
      else result.failed += 1;
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
      const delay = Math.min(
        EventRelayService.MAX_BACKOFF_MS,
        EventRelayService.BASE_BACKOFF_MS * 2 ** Math.min(attempts - 1, 20),
      );
      await this.outbox.markFailed(row.id, reason, new Date(now.getTime() + delay));
      this.logger.warn(`${row.event} ${row.eventId} not delivered (try ${attempts}): ${reason}`);
      if (attempts === EventRelayService.ALERT_AT_ATTEMPT) {
        alertServerError({
          method: 'POST',
          path: 'depot-webhook-outbox#stuck',
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
