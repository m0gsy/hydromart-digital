/**
 * AAS-11: the durable record of a partner-webhook event admin-service has not yet accepted.
 *
 * Publishing used to be one inline POST behind a swallowed catch, so an admin-service blip
 * meant the event was gone for every subscribed partner. A row here is written BEFORE the
 * send and closed when it lands; a sweep re-sends what is still open.
 */
export type EventOutboxStatus = 'PENDING' | 'DONE' | 'DEAD';

export interface EventOutboxRecord {
  id: string;
  event: string;
  /** The idempotency key admin-service dedupes on; also this table's unique key. */
  eventId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  status: EventOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
}

export interface EventOutboxRepository {
  /**
   * Idempotent on `eventId`: recording the same event twice leaves one row. Answers the new
   * row, or null when the key was already there (its first recording owns the send).
   */
  enqueue(row: {
    event: string;
    eventId: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<EventOutboxRecord | null>;
  /** The row that owns this key, whatever its state; null when none was ever recorded. */
  findByEventId(eventId: string): Promise<EventOutboxRecord | null>;
  /**
   * Deletes up to `limit` DONE rows last touched before `before`; answers how many went.
   * Bounded so one sweep never issues an unbounded DELETE against a table written on every
   * handover. PENDING and DEAD rows are never pruned: they are the work still owed and the
   * work somebody has to look at.
   */
  pruneDone(before: Date, limit: number): Promise<number>;
  /** PENDING rows whose backoff has elapsed, oldest first. */
  findDue(now: Date, limit: number): Promise<EventOutboxRecord[]>;
  /** Only a still-PENDING row is closed, so a late success cannot revive a DEAD one. */
  markDone(id: string): Promise<void>;
  /** Bumps attempts and records why; `nextAttemptAt: null` means retries are spent (DEAD). */
  markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
}
