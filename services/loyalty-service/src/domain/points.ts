// Points ledger domain rules (BR-013 earn on order completion, BR-014 expiry).

export enum PointsTxnType {
  EARN = 'EARN',
  EXPIRE = 'EXPIRE',
  ADJUST = 'ADJUST',
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
