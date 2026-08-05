/**
 * H-10: the durable record of a side effect an order still owes.
 *
 * Stock consume, the loyalty award, the referral qualification and the franchise-owner
 * credit used to be fire-and-forget HTTP calls behind a swallowed catch. A depot-service
 * blip left the checkout hold unsettled and the depot's sellable stock drifting down
 * forever; a payout-service blip meant an owner was never paid for a sale that happened.
 */
export type OutboxTopic =
  | 'INVENTORY_CONSUME'
  | 'LOYALTY_AWARD'
  | 'REFERRAL_QUALIFY'
  | 'FRANCHISE_REVENUE';

export type OutboxStatus = 'PENDING' | 'DONE' | 'DEAD';

export interface OutboxMessageRecord {
  id: string;
  topic: OutboxTopic;
  orderId: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
}

/** What an order owes, written alongside the state change that earns it. */
export interface OutboxWrite {
  topic: OutboxTopic;
  orderId: string;
}

export interface OutboxRepository {
  /**
   * PENDING messages whose backoff has elapsed, oldest first.
   *
   * Not a lock: two sweeps overlapping would each pick up the same row, which is safe
   * because every handler is idempotent on the receiving side (keyed by order id) — the
   * same property that makes retrying safe at all.
   */
  claimDue(now: Date, limit: number): Promise<OutboxMessageRecord[]>;
  /** The effect landed; the row is closed and never picked up again. */
  markDone(id: string): Promise<void>;
  /**
   * The effect failed. Bumps the attempt count, records why, and either schedules the
   * next try or gives up — a row nobody will retry has to say so, not sit as PENDING
   * forever pretending it is still coming.
   */
  markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
  /** Everything still owed, for the ops view of a sweep that is not keeping up. */
  countByStatus(): Promise<Record<OutboxStatus, number>>;
}
