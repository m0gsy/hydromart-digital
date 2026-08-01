/**
 * Awards loyalty points for a completed order (BR-013). Loyalty is non-critical to
 * fulfilment, so implementations fail OPEN: a failure must never block completing an
 * order. The completing staff member's token is forwarded so loyalty-service enforces
 * its own RBAC. `depotId` is forwarded so loyalty-service can apply a per-depot earn-rate
 * override instead of the global rate.
 *
 * Returns the points actually awarded (0 when the order already earned or the subtotal is
 * too small), or null when the award never happened. Callers must NOT recompute the figure
 * from the subtotal: the earn rate is per-depot, so a local divisor quotes the wrong number
 * at every depot that overrode it.
 */
export interface LoyaltyCoordinationPort {
  awardPoints(
    customerId: string,
    orderId: string,
    subtotal: number,
    depotId: string | null,
    authorization: string,
  ): Promise<number | null>;
}
