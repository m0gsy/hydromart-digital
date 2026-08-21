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
}

/**
 * Books gallons out on deposit. Runs from the completion outbox, so unlike the fail-open
 * adapters it MUST throw on failure: a swallowed error here is a deposit the depot holds
 * in fact and not in its book, and the next return then refunds Rp0. Idempotent on the
 * depot side (unique on order id), so the outbox's at-least-once retry is safe.
 */
export interface GallonIssuePort {
  orderDelivered(event: GallonIssueEvent): Promise<void>;
}
