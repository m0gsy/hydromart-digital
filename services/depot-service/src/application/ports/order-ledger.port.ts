/**
 * Owner decision 2026-11-21: head office may not change who owns a depot while franchise
 * revenue for its orders is still owed in order-service's outbox. That revenue is credited by
 * the owners as of each order's completion, and a moment before any owner generation falls
 * back to the CURRENT owners — so an HKP sale retried after the depot turned WARALABA would pay
 * the new owner.
 *
 * Fails CLOSED: an ownership change is rare and can wait a minute; crediting the wrong person
 * cannot be taken back by retrying.
 */
export interface OrderLedgerPort {
  /** How many franchise credits or voids for this depot's orders are still PENDING. */
  pendingRevenue(depotId: string): Promise<number>;
}
