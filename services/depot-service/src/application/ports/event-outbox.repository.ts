/**
 * HD-7: the durable record of a webhook event admin-service has not taken yet (the same
 * contract as delivery-service's AAS-11 outbox). A row is written in the same transaction as the
 * thing it reports, and closed when admin-service accepts it; a sweep re-sends what is open.
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
  /** The row that owns this key, whatever its state; null when none was ever recorded. */
  findByEventId(eventId: string): Promise<EventOutboxRecord | null>;
  /** PENDING rows whose backoff has elapsed, oldest first. */
  findDue(now: Date, limit: number): Promise<EventOutboxRecord[]>;
  /** Only a still-PENDING row is closed, so a late success cannot revive a DEAD one. */
  markDone(id: string): Promise<void>;
  /**
   * Bumps attempts and records why; `nextAttemptAt: null` means retries are spent (DEAD). Only a
   * still-PENDING row is touched, so a late failure cannot reopen a row another send closed.
   */
  markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
  /**
   * Deletes up to `limit` DONE rows last touched before `before`; answers how many went. PENDING
   * and DEAD rows are never pruned: the work still owed, and the work somebody has to look at.
   */
  pruneDone(before: Date, limit: number): Promise<number>;
}
