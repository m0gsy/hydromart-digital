/**
 * Awards loyalty points for a completed order (BR-013). Loyalty is non-critical to
 * fulfilment, so implementations fail OPEN: a failure must never block completing an
 * order. The completing staff member's token is forwarded so loyalty-service enforces
 * its own RBAC.
 */
export interface LoyaltyCoordinationPort {
  awardPoints(
    customerId: string,
    orderId: string,
    subtotal: number,
    authorization: string,
  ): Promise<void>;
}
