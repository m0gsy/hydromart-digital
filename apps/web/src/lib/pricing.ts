// Pure helpers for the dynamic-pricing console. Covered by test/pricing.test.ts.
// Client-side pre-validation mirrors depot-service's DTO; the server stays authority.

import type { PricingAdjustType, PricingRulePayload, ResolvedPrice } from './types';

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
