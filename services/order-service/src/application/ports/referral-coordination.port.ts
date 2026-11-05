/**
 * Qualifies a referral when a referee completes an order (FR-092). Referrals are
 * non-critical to fulfilment: a failure never rolls back completion, but throws into
 * the outbox so the effect stays owed. Referral rewards use stable idempotency keys.
 */
export interface ReferralCoordinationPort {
  qualify(customerId: string, orderId: string, authorization: string): Promise<void>;
  reverse(customerId: string, orderId: string): Promise<void>;
}
