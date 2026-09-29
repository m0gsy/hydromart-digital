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
export interface PointsAward {
  points: number;
  /**
   * The tier this earn lifted the customer into ("SILVER"), or null when it did not move them
   * up — including when loyalty-service is an older build that does not say. Null is the safe
   * reading: the customer simply gets no congratulation.
   */
  tierUpgradedTo: string | null;
}

export interface LoyaltyCoordinationPort {
  awardPoints(
    customerId: string,
    orderId: string,
    subtotal: number,
    depotId: string | null,
    authorization: string,
  ): Promise<PointsAward | null>;

  /**
   * Takes back the points a reversed sale awarded. Named by order, never by an amount:
   * loyalty-service owns the per-depot earn rate, so a figure computed here would claw back
   * the wrong number at every depot that overrode it.
   *
   * Fails OPEN like the award. The buyer already has their money back by the time this runs,
   * and blocking the void on a loyalty outage would leave the goods, the cash and the order
   * in three different states.
   */
  reversePoints(customerId: string, orderId: string, reason: string): Promise<void>;
}
