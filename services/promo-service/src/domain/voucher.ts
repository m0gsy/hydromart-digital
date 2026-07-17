// Voucher discount domain rules (PRD FR-089 Coupon, FR-090 Voucher). Money is
// integer rupiah throughout — every result is floored and clamped to the subtotal.

import {
  MinSpendNotMetError,
  VoucherBudgetExhaustedError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
  VoucherInactiveError,
  VoucherNotStartedError,
  VoucherUsageExceededError,
} from './errors';

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
  FREE_SHIPPING = 'FREE_SHIPPING',
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
  budgetCap: number | null;
  active: boolean;
}

/**
 * Discount (rupiah) this voucher grants. PERCENTAGE takes `value`% of the
 * subtotal, floored, capped by `maxDiscount` when set, never above the subtotal.
 * FIXED takes `value` rupiah off the subtotal. FREE_SHIPPING waives the delivery
 * fee (capped by `maxDiscount` when set) — it does not touch the subtotal, so the
 * caller must supply `shippingFee`. Never negative.
 */
export function computeDiscount(v: VoucherRules, subtotal: number, shippingFee = 0): number {
  let raw: number;
  switch (v.discountType) {
    case DiscountType.PERCENTAGE:
      raw = Math.min(Math.floor((subtotal * v.value) / 100), v.maxDiscount ?? Infinity, subtotal);
      break;
    case DiscountType.FREE_SHIPPING:
      raw = Math.min(shippingFee, v.maxDiscount ?? Infinity);
      break;
    default: // FIXED
      raw = Math.min(v.value, subtotal);
  }
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
  burnedSoFar = 0,
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
  // Budget is exhausted once cumulative discount reaches the cap (soft budget: the
  // in-flight redemption is allowed to tip it over, but the next one is blocked).
  if (v.budgetCap !== null && burnedSoFar >= v.budgetCap) {
    throw new VoucherBudgetExhaustedError();
  }
}
