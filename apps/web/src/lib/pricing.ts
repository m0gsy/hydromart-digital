// Pure helpers for the dynamic-pricing console. Covered by test/pricing.test.ts.
// Client-side pre-validation mirrors depot-service's DTO; the server stays authority.

import type { CartLine, PricingAdjustType, PricingRulePayload, ResolvedPrice } from './types';

/**
 * Galons in a cart. Delivery is charged per galon (fee × this), so bottled dus and
 * accessories don't add to the ongkir. Mirrors `galonQuantity` in
 * order-service/src/domain/pricing.ts, which prices the real order — keep the two in step
 * or the checkout preview lies about the total.
 *
 * Reads the catalog's `isGallon` flag, the same field the server bills on. It used to match
 * the "Galon…" prefix of the free-text `unit` label; the server dropped that match on
 * purpose so a label edit could not change what a customer is charged, and this side kept
 * matching for one release too long — a product flagged `isGallon` but labelled "Botol 19L"
 * previewed Rp0 ongkir and was then billed per galon.
 */
export function galonQuantity(items: CartLine[]): number {
  return items.reduce((n, i) => (i.isGallon ? n + i.quantity : n), 0);
}

/**
 * A7 — the ONE rounding rule this app is allowed to use for money.
 *
 * Mirrors `money()` in packages/platform/src/domain/money.ts, which is what the server
 * bills through. Pinned to it by "rounds a price exactly like platform money()" in
 * test/pricing.test.ts, which imports the real function rather than restating the rule.
 *
 * It exists because there were three rules for one number: the cart page floored the
 * member discount, the checkout page rounded it, and the server rounded it. Measured on
 * ordinary baskets — Rp20.999 at 5% reads Rp1.049 on the cart page and Rp1.050 everywhere
 * else; Rp33.333 at 3% reads Rp999 against Rp1.000. One rupiah, on the one screen whose
 * whole job is to agree with the bill.
 */
export function money(value: number): number {
  return Math.round(value);
}

/**
 * What the membership tier takes off a subtotal. Both the cart page and the checkout
 * summary quote this, so they cannot answer differently — which they did, by flooring in
 * one place and rounding in the other.
 */
export function memberDiscount(subtotal: number, rate: number): number {
  return money(subtotal * rate);
}

/**
 * Ongkir for a cart at one depot: per-galon fee × galons, in whole rupiah. Whole because the
 * voucher quote sends it to promo-service, whose DTO takes an `@IsInt()` — a fractional fee
 * would come back 400 and read on screen as "voucher ditolak".
 */
export function shippingFeeFor(perGalonFee: number, items: CartLine[]): number {
  return money(perGalonFee * galonQuantity(items));
}

export interface RuleForm {
  productId: string; // blank = depot-wide
  adjustType: PricingAdjustType;
  value: string;
  daysOfWeek: number[];
  startTime: string; // HH:MM, blank = all day
  endTime: string;
  validFrom: string; // YYYY-MM-DD, blank = open
  validUntil: string;
  priority: string;
  active: boolean;
}

export const EMPTY_RULE_FORM: RuleForm = {
  productId: '',
  adjustType: 'PERCENT',
  value: '',
  daysOfWeek: [],
  startTime: '',
  endTime: '',
  validFrom: '',
  validUntil: '',
  priority: '',
  active: true,
};

export interface EffectivePrice {
  base: number;
  override: number | null;
  adjustType: PricingAdjustType | null;
  adjustValue: number | null;
  effective: number;
}

/**
 * Resolve a product's effective per-depot price for the preview (11a). Mirrors
 * order-service checkout math exactly: start from the override (falling back to the
 * catalog base), apply the winning active rule, floor at 0, round to whole rupiah.
 */
export function computeEffective(base: number, resolved?: ResolvedPrice): EffectivePrice {
  // A wholesale band is an absolute unit price and wins outright — order-service honours it
  // over both the override and the rule (order.service.ts), so a screen that applied the rule
  // on top quoted a price the order never charged.
  if (resolved?.tierPrice !== undefined && resolved.tierPrice > 0) {
    return {
      base,
      override: resolved.sellPrice ?? null,
      adjustType: null,
      adjustValue: null,
      effective: Math.round(Math.max(0, resolved.tierPrice)),
    };
  }
  const override = resolved?.sellPrice ?? null;
  const start = override ?? base;
  const adjustType = resolved?.adjustType ?? null;
  const adjustValue = adjustType ? resolved?.value ?? 0 : null;
  const raw =
    adjustType === 'PERCENT'
      ? start * (1 + (adjustValue ?? 0) / 100)
      : adjustType === 'FIXED'
        ? start + (adjustValue ?? 0)
        : start;
  return { base, override, adjustType, adjustValue, effective: Math.round(Math.max(0, raw)) };
}

function toMinutes(hhmm: string): number | null {
  if (hhmm.trim() === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN as unknown as number;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN as unknown as number;
  return h * 60 + min;
}

/** Coerce the string form into an API payload, or return the first validation error. */
export function toRulePayload(
  form: RuleForm,
): { ok: true; value: PricingRulePayload } | { ok: false; error: string } {
  if (form.adjustType !== 'PERCENT' && form.adjustType !== 'FIXED') {
    return { ok: false, error: 'Pick an adjustment type.' };
  }
  const value = Number(form.value);
  if (form.value.trim() === '' || !Number.isFinite(value)) {
    return { ok: false, error: 'Value must be a number.' };
  }

  const startMinute = toMinutes(form.startTime);
  const endMinute = toMinutes(form.endTime);
  if (Number.isNaN(startMinute) || Number.isNaN(endMinute)) {
    return { ok: false, error: 'Times must be HH:MM.' };
  }
  if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
    return { ok: false, error: 'End time must be after start time.' };
  }

  const validFrom = form.validFrom.trim() || null;
  const validUntil = form.validUntil.trim() || null;
  if (validFrom && validUntil && validUntil < validFrom) {
    return { ok: false, error: 'Valid-until must not precede valid-from.' };
  }

  const priority = form.priority.trim() === '' ? 0 : Number(form.priority);
  if (!Number.isInteger(priority)) {
    return { ok: false, error: 'Priority must be a whole number.' };
  }

  return {
    ok: true,
    value: {
      productId: form.productId.trim() || null,
      adjustType: form.adjustType,
      value,
      daysOfWeek: [...form.daysOfWeek].sort((a, b) => a - b),
      startMinute,
      endMinute,
      validFrom,
      validUntil,
      priority,
      active: form.active,
    },
  };
}
