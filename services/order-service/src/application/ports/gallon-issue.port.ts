/**
 * I1: the empties a completed delivery carried out, reported to depot-service so the
 * gallon-issue ledger is written by fulfilment instead of by nobody.
 *
 * No amount travels. depot-service derives the deposit from its own per-depot rate, the
 * same way it derives a courier refund — a caller that could name the figure could book a
 * deposit the depot never charged, and that ledger is what every later refund is measured
 * against.
 */
export interface GallonIssueEvent {
  depotId: string;
  orderId: string;
  /** Null for an anonymous counter sale — nobody to hold a deposit against. */
  customerId: string | null;
  /** Gallons that left the depot on this order. Always > 0; the caller checks. */
  quantity: number;
  /**
   * HD-6 (#24-A): empties the buyer handed back at the counter on this same sale (a refill).
   * Depot-service books them as a return right after the issue, so a refill nets to zero
   * gallons at the customer. Absent for a new-gallon sale and for every delivery — a courier
   * records a delivery's empties herself, at the door.
   */
  emptiesReturned?: number;
}

/** HD-6 (#24-A): a counter sale was voided, so the gallons it booked go back. */
export interface GallonVoidEvent {
  depotId: string;
  orderId: string;
}

/**
 * Books gallons out on deposit. Runs from the completion outbox, so unlike the fail-open
 * adapters it MUST throw on failure: a swallowed error here is a deposit the depot holds
 * in fact and not in its book, and the next return then refunds Rp0. Idempotent on the
 * depot side (unique on order id), so the outbox's at-least-once retry is safe.
 */
export interface GallonIssuePort {
  orderDelivered(event: GallonIssueEvent): Promise<void>;
  /**
   * Reverses what `orderDelivered` booked for a voided counter sale (the issue and, for a
   * refill, the return). Same contract: throws on failure, idempotent on the depot side, a
   * no-op when nothing was ever booked for the order.
   */
  orderVoided(event: GallonVoidEvent): Promise<void>;
}
