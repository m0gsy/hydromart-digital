/**
 * Awards loyalty points to a customer as part of referral qualification. Implementations
 * fail OPEN: a loyalty outage must never break referral qualification.
 */
export interface LoyaltyRewardPort {
  reward(customerId: string, points: number, reason: string, authorization: string): Promise<void>;
}
