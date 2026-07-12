// Points ledger domain rules (BR-013 earn on order completion, BR-014 expiry).

export enum PointsTxnType {
  EARN = 'EARN',
  EXPIRE = 'EXPIRE',
  ADJUST = 'ADJUST',
  // Flat system-granted bonus (e.g. referral rewards). Positive, counts toward
  // lifetime/tier like EARN, but is not tied to an order subtotal.
  REWARD = 'REWARD',
  // Negative spend against the redeem catalog (FR-015). Debits the balance but
  // must NOT touch lifetimePoints/tier — spending points can't raise a tier.
  REDEEM = 'REDEEM',
}

/**
 * Points earned for an order (BR-013): one point per `earnRateRupiah` of the order
 * subtotal, floored. Only the product subtotal earns — delivery fees do not.
 */
export function pointsForOrder(subtotal: number, earnRateRupiah: number): number {
  if (subtotal <= 0 || earnRateRupiah <= 0) return 0;
  return Math.floor(subtotal / earnRateRupiah);
}

/** When a lot earned now expires (BR-014). */
export function expiryFrom(earnedAt: Date, months: number): Date {
  const expires = new Date(earnedAt.getTime());
  expires.setMonth(expires.getMonth() + months);
  return expires;
}
