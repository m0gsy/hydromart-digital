// Voucher discount domain rules (PRD FR-089 Coupon, FR-090 Voucher). Money is
// integer rupiah throughout — every result is floored and clamped to the subtotal.

import {
  MinSpendNotMetError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
  VoucherInactiveError,
  VoucherNotStartedError,
  VoucherUsageExceededError,
} from './errors';

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}

/** The subset of a voucher the pure domain rules need. */
export interface VoucherRules {
  discountType: DiscountType;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  active: boolean;
}

/**
 * Discount (rupiah) this voucher grants against `subtotal`. PERCENTAGE takes
 * `value`% of the subtotal, floored, capped by `maxDiscount` when set. FIXED
 * takes `value` rupiah. The result never exceeds the subtotal and is never
 * negative.
 */
export function computeDiscount(v: VoucherRules, subtotal: number): number {
  const raw =
    v.discountType === DiscountType.PERCENTAGE
      ? Math.min(Math.floor((subtotal * v.value) / 100), v.maxDiscount ?? Infinity, subtotal)
      : Math.min(v.value, subtotal);
  return Math.max(0, raw);
}

/** Status of a voucher in a customer's wallet (spec 4a "Voucher kamu"). */
export type VoucherStatus = 'AVAILABLE' | 'USED' | 'EXPIRED' | 'UPCOMING' | 'SOLD_OUT';

/**
 * Classify an active voucher for a customer's wallet. Pure counterpart to
 * {@link validateVoucher}: it returns a status instead of throwing, so the
 * wallet can render every voucher (redeemable or not). Precedence: time window
 * first, then global sell-out, then the customer's own usage.
 */
export function classifyVoucherStatus(
  v: Pick<VoucherRules, 'validFrom' | 'validUntil' | 'usageLimit' | 'perCustomerLimit'> & {
    usedCount: number;
  },
  now: Date,
  customerRedemptionCount: number,
): VoucherStatus {
  if (v.validUntil !== null && now > v.validUntil) return 'EXPIRED';
  if (v.validFrom !== null && now < v.validFrom) return 'UPCOMING';
  if (v.usageLimit !== null && v.usedCount >= v.usageLimit) return 'SOLD_OUT';
  if (customerRedemptionCount >= v.perCustomerLimit) return 'USED';
  return 'AVAILABLE';
}

/**
 * Throws the appropriate domain error when the voucher may not be applied to
 * this order, otherwise returns void. Pure — the caller supplies `now` and the
 * usage counts so the function stays side-effect free.
 */
export function validateVoucher(
  v: VoucherRules,
  subtotal: number,
  now: Date,
  globalUsedCount: number,
  customerRedemptionCount: number,
): void {
  if (!v.active) throw new VoucherInactiveError();
  if (v.validFrom !== null && now < v.validFrom) throw new VoucherNotStartedError();
  if (v.validUntil !== null && now > v.validUntil) throw new VoucherExpiredError();
  if (subtotal < v.minSpend) throw new MinSpendNotMetError(v.minSpend);
  if (v.usageLimit !== null && globalUsedCount >= v.usageLimit) {
    throw new VoucherUsageExceededError();
  }
  if (customerRedemptionCount >= v.perCustomerLimit) {
    throw new VoucherCustomerLimitReachedError();
  }
}
