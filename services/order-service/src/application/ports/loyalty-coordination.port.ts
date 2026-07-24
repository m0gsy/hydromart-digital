/**
 * Awards loyalty points for a completed order (BR-013). Loyalty is non-critical to
 * fulfilment, so implementations fail OPEN: a failure must never block completing an
 * order. The completing staff member's token is forwarded so loyalty-service enforces
 * its own RBAC. `depotId` is forwarded so loyalty-service can apply a per-depot earn-rate
 * override instead of the global rate.
 */
export interface LoyaltyCoordinationPort {
  awardPoints(
    customerId: string,
    orderId: string,
    subtotal: number,
    depotId: string | null,
    authorization: string,
  ): Promise<void>;
}
