/**
 * HD-17B: the durable record of a webhook event admin-service has not taken yet (the shape of
 * delivery-service's AAS-11 outbox). A row is written in the same transaction as the thing it
 * reports, and closed when admin-service accepts it; a sweep re-sends what is open. No row is
 * ever given up (see EventRelayService), so there is no DEAD state here.
 */
export type EventOutboxStatus = 'PENDING' | 'DONE';

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
  /** How many events have been owed since `cutoff` or earlier (counted from when they were written). */
  countStuck(cutoff: Date): Promise<number>;
  /** PENDING rows whose backoff has elapsed, oldest first. */
  findDue(now: Date, limit: number): Promise<EventOutboxRecord[]>;
  /**
   * Takes a due row for one sender: a conditional update that pushes nextAttemptAt to `until`
   * only while the row is still PENDING and due. False when another sweep got there first (or
   * it was closed), so two overlapping sweeps never send the same row twice. A sender that dies
   * leaves the row to come due again at `until`.
   */
  claim(id: string, now: Date, until: Date): Promise<boolean>;
  /** Closes a still-PENDING row; closing one twice is harmless. */
  markDone(id: string): Promise<void>;
  /**
   * Bumps attempts, records why and when to try again. Only a still-PENDING row is touched, so a
   * late failure cannot reopen a row another send closed.
   */
  markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  /**
   * Deletes up to `limit` DONE rows last touched before `before`; answers how many went. A
   * PENDING row is never pruned: it is work still owed.
   */
  pruneDone(before: Date, limit: number): Promise<number>;
}
