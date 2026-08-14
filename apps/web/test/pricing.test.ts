import { describe, expect, it } from 'vitest';

import {
  EMPTY_RULE_FORM,
  computeEffective,
  galonQuantity,
  toRulePayload,
  type RuleForm,
} from '@/lib/pricing';
import type { CartLine, ResolvedPrice } from '@/lib/types';
// Test-only reach into the server's money contract — see "rounding parity" below.
import { money } from '../../../packages/platform/src/domain/money';

function line(unit: string, quantity: number, isGallon = unit.trim().toLowerCase().startsWith('galon')): CartLine {
  return {
    productId: 'p1',
    productName: 'Air',
    sku: 'SKU',
    unit,
    unitPrice: 20000,
    quantity,
    lineTotal: 20000 * quantity,
    isGallon,
  };
}

// The checkout ongkir preview is depot.deliveryFee × galonQuantity. order-service prices the
// real order the same way, so these cases mirror its rule and catch drift between the two.
describe('galonQuantity (mirrors the ongkir charge)', () => {
  it('counts galon lines and ignores everything else', () => {
    expect(galonQuantity([line('Galon 19L', 2), line('Dus', 3), line('galon', 1)])).toBe(3);
  });

  it('is zero for a cart with no galon', () => {
    expect(galonQuantity([line('Botol 600ml', 12)])).toBe(0);
  });

  // The flag is what the server bills on, and it is allowed to disagree with the label: the
  // label is free text a depot can edit, the flag is catalog data. Counting by label made the
  // preview and the bill disagree in BOTH directions.
  it('counts a flagged line whose label does not say galon', () => {
    expect(galonQuantity([line('Botol 19L', 3, true)])).toBe(3);
  });

  it('does not count an unflagged line whose label does say galon', () => {
    expect(galonQuantity([line('Galon (kosong, tukar)', 2, false)])).toBe(0);
  });
});

/** Only the three fields computeEffective reads; the rest of ResolvedPrice is noise here. */
const resolved = (over: Partial<ResolvedPrice>): ResolvedPrice =>
  ({ productId: 'p1', sellPrice: 18000, ...over });

describe('computeEffective (mirrors checkout math)', () => {
  it('falls back to the catalog base when there is no override or rule', () => {
    expect(computeEffective(20000)).toMatchObject({ base: 20000, override: null, effective: 20000 });
  });

  it('applies a PERCENT surge off the override, rounded to whole rupiah', () => {
    const r = computeEffective(20000, resolved({ adjustType: 'PERCENT', value: 10 }));
    expect(r.effective).toBe(19800); // 18000 * 1.10
  });

  it('applies a FIXED delta off the override', () => {
    const r = computeEffective(20000, resolved({ adjustType: 'FIXED', value: -3000 }));
    expect(r.effective).toBe(15000);
  });

  it('floors a deep discount at zero (never negative)', () => {
    const r = computeEffective(20000, resolved({ sellPrice: 5000, adjustType: 'FIXED', value: -9000 }));
    expect(r.effective).toBe(0);
  });
});

describe('toRulePayload validation', () => {
  const form = (over: Partial<RuleForm>): RuleForm => ({ ...EMPTY_RULE_FORM, value: '10', ...over });

  it('accepts a minimal valid percent rule and sorts daysOfWeek', () => {
    const res = toRulePayload(form({ daysOfWeek: [5, 1, 3] }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.daysOfWeek).toEqual([1, 3, 5]);
      expect(res.value.productId).toBeNull(); // blank -> depot-wide
      expect(res.value.priority).toBe(0); // blank -> 0
    }
  });

  it('rejects a non-numeric value', () => {
    expect(toRulePayload(form({ value: 'abc' }))).toEqual({ ok: false, error: 'Value must be a number.' });
  });

  it('rejects a malformed time', () => {
    expect(toRulePayload(form({ startTime: '25:00' })).ok).toBe(false);
    expect(toRulePayload(form({ startTime: '9am' })).ok).toBe(false);
  });

  it('rejects an end time not after the start', () => {
    const res = toRulePayload(form({ startTime: '10:00', endTime: '09:00' }));
    expect(res).toEqual({ ok: false, error: 'End time must be after start time.' });
  });

  it('accepts a valid time window and converts to minutes', () => {
    const res = toRulePayload(form({ startTime: '17:00', endTime: '20:30' }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.startMinute).toBe(1020);
      expect(res.value.endMinute).toBe(1230);
    }
  });

  it('rejects a valid-until before valid-from', () => {
    const res = toRulePayload(form({ validFrom: '2026-08-10', validUntil: '2026-08-01' }));
    expect(res).toEqual({ ok: false, error: 'Valid-until must not precede valid-from.' });
  });

  it('rejects a non-integer priority', () => {
    expect(toRulePayload(form({ priority: '1.5' })).ok).toBe(false);
  });
});

/**
 * Server↔client rounding parity. Nothing asserted it before, and the two had drifted: the
 * server kept two decimals while every price on screen was whole rupiah, so a percentage
 * discount produced a preview the stored order contradicted by cents.
 *
 * `money()` is imported from the platform package directly — that is the contract, and this
 * test is the only place the web tree is allowed to reach for it. It must NOT be imported by
 * app code: the package's entrypoint pulls in Nest, which has no business in a browser
 * bundle. The rule is one line long, so the client re-states it and this pins the two equal.
 */
describe('rounding parity with the server', () => {
  it('rounds a price exactly like platform money()', () => {
    for (const raw of [0, 0.5, 1.5, 4999.04, 4999.95, 19_000, 99_999 * 0.05]) {
      expect(Math.round(raw)).toBe(money(raw));
    }
  });

  it('computeEffective agrees with money() on a fractional PERCENT rule', () => {
    // 4.999 with a 3% cut = 4,849.03 — the case that used to store cents. The override IS
    // the starting price here, so it carries the fraction rather than the catalog base.
    const r = computeEffective(20000, resolved({ sellPrice: 4999, adjustType: 'PERCENT', value: -3 }));
    expect(r.effective).toBe(money(4999 * 0.97));
  });

  // A wholesale band is an absolute unit price. order-service honours it over both the depot
  // override and the active rule; the client used to have no field for it at all, so a
  // 20-galon till sale showed Rp380.000 against the Rp320.000 the order stored.
  it('lets a wholesale band win over the override and the rule', () => {
    const r = computeEffective(
      19000,
      resolved({ sellPrice: 18000, adjustType: 'PERCENT', value: 10, tierPrice: 16000 }),
    );
    expect(r.effective).toBe(16000);
    expect(r.adjustType).toBeNull();
  });

  it('ignores a zero tierPrice — that is "no band for this line", not a free galon', () => {
    const r = computeEffective(19000, resolved({ sellPrice: 18000, tierPrice: 0 }));
    expect(r.effective).toBe(18000);
  });

  it('membership discount rounds exactly like the server', () => {
    // What checkout/page.tsx computes for the preview, against what order.service.ts stores.
    const subtotal = 99_999;
    const rate = 0.05;
    expect(Math.round(subtotal * rate)).toBe(money(subtotal * rate));
  });
});
