/**
 * Awards loyalty points to a customer as part of referral qualification. Implementations
 * use an idempotency key so an outbox retry cannot grant the same reward twice.
 */
export interface LoyaltyRewardPort {
  reward(customerId: string, points: number, reason: string, authorization: string, idempotencyKey: string): Promise<void>;
}
