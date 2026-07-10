/**
 * Qualifies a referral when a referee completes an order (FR-092). Referrals are
 * non-critical to fulfilment, so implementations fail OPEN: a failure must never
 * block completing an order. The completing staff member's token is forwarded so
 * referral-service (and the loyalty reward it triggers) enforce their own RBAC.
 * Qualification is idempotent on the referral side, so a retried completion will
 * not double-reward.
 */
export interface ReferralCoordinationPort {
  qualify(customerId: string, orderId: string, authorization: string): Promise<void>;
}
