/**
 * Grants loyalty points to a customer (birthday promo, FR-091). Unlike a fire-and-forget
 * reward, the birthday sweep needs to know whether the grant landed so it only stamps the
 * "rewarded this year" marker on success — therefore this port THROWS on failure and the
 * caller decides per-customer. Idempotency across re-runs is the caller's year stamp.
 */
export interface LoyaltyRewardPort {
  reward(customerId: string, points: number, reason: string, authorization: string): Promise<void>;
}
