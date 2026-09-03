import { money } from '@hydromart/platform';

// Voucher discount domain rules (PRD FR-089 Coupon, FR-090 Voucher). Money is integer
// rupiah throughout, ROUNDED by the platform's shared `money()` and clamped to the
// subtotal. It used to say "floored", and it was — which is how a percentage voucher and a
// percentage membership discount could differ by a rupiah on the same basket.

import {
  MinSpendNotMetError,
  VoucherBudgetExhaustedError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
  VoucherInactiveError,
  VoucherNotStartedError,
  VoucherUsageExceededError,
  VoucherWrongDepotError,
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
  /** CA-2-65: the depot this voucher belongs to; null = network-wide. */
  depotId?: string | null;
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
      /*
       * `money()`, not `Math.floor`.
       *
       * The platform has one rupiah rule — half-up `Math.round` — and its own header says
       * why: two private copies of a rounding rule is one copy away from two different
       * rounding rules. This was the copy. A membership discount of 15% on Rp4.999 came to
       * 750 (`money(subtotal * rate)`) and a 15% VOUCHER on the same basket came to 749,
       * because floor rounds the discount down and round does not.
       *
       * Nobody could see it: each mechanism is internally consistent end to end, and the
       * order total is what the payment is checked against either way (SEC-1). It only
       * shows up when the same customer compares the same percentage from two sources.
       *
       * The direction is one rupiah MORE discount, half the time. That is the shared rule,
       * and matching it is the point.
       */
      raw = Math.min(money((subtotal * v.value) / 100), v.maxDiscount ?? Infinity, subtotal);
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
  /** Total discount already burned on this voucher PLUS the discount now being applied. */
  burnedWithThis = 0,
  /**
   * CA-2-65: the depot this order belongs to, when the caller knows it.
   *
   * `undefined` means the caller could not say — an older client, or a path with no depot
   * — and a depot-scoped voucher is then REFUSED rather than allowed through. The whole
   * bug was a scoped voucher spending network-wide; defaulting the unknown case to "allow"
   * would leave the same hole open under a new name.
   */
  orderDepotId?: string | null,
): void {
  if (!v.active) throw new VoucherInactiveError();
  if (v.depotId != null && v.depotId !== orderDepotId) throw new VoucherWrongDepotError();
  if (v.validFrom !== null && now < v.validFrom) throw new VoucherNotStartedError();
  if (v.validUntil !== null && now > v.validUntil) throw new VoucherExpiredError();
  if (subtotal < v.minSpend) throw new MinSpendNotMetError(v.minSpend);
  if (v.usageLimit !== null && globalUsedCount >= v.usageLimit) {
    throw new VoucherUsageExceededError();
  }
  if (customerRedemptionCount >= v.perCustomerLimit) {
    throw new VoucherCustomerLimitReachedError();
  }
  // Hard budget: the caller passes the burn INCLUDING this redemption's discount, so the
  // order that would tip the campaign past its cap is the one rejected. A redemption that
  // lands exactly on the cap still goes through.
  if (v.budgetCap !== null && burnedWithThis > v.budgetCap) {
    throw new VoucherBudgetExhaustedError();
  }
}
