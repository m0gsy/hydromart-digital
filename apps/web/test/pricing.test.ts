import { describe, expect, it } from 'vitest';
import { EMPTY_RULE_FORM, computeEffective, toRulePayload } from '../src/lib/pricing';

describe('computeEffective', () => {
  it('returns the base when there is no override or rule', () => {
    expect(computeEffective(20000).effective).toBe(20000);
  });

  it('uses the override as the starting price', () => {
    expect(computeEffective(20000, { productId: 'p', sellPrice: 18000 }).effective).toBe(18000);
  });

  it('applies a percent rule to the override, floors at 0, rounds', () => {
    // start 18000, -10% => 16200
    const e = computeEffective(20000, { productId: 'p', sellPrice: 18000, adjustType: 'PERCENT', value: -10 });
    expect(e.effective).toBe(16200);
  });

  it('applies a fixed rule to the base and never goes below 0', () => {
    expect(computeEffective(5000, { productId: 'p', adjustType: 'FIXED', value: -9000 }).effective).toBe(0);
  });
});

describe('toRulePayload', () => {
  it('builds a minimal depot-wide percentage rule', () => {
    const r = toRulePayload({ ...EMPTY_RULE_FORM, adjustType: 'PERCENT', value: '-10' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.adjustType).toBe('PERCENT');
      expect(r.value.value).toBe(-10);
      expect(r.value.productId).toBeNull();
      expect(r.value.daysOfWeek).toEqual([]);
      expect(r.value.startMinute).toBeNull();
    }
  });

  it('rejects a non-numeric value', () => {
    const r = toRulePayload({ ...EMPTY_RULE_FORM, value: 'abc' });
    expect(r.ok).toBe(false);
  });

  it('parses HH:MM times into minutes and rejects end <= start', () => {
    const ok = toRulePayload({ ...EMPTY_RULE_FORM, value: '-5', startTime: '10:00', endTime: '13:30' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.startMinute).toBe(600);
      expect(ok.value.endMinute).toBe(810);
    }
    const bad = toRulePayload({ ...EMPTY_RULE_FORM, value: '-5', startTime: '13:00', endTime: '10:00' });
    expect(bad.ok).toBe(false);
  });

  it('rejects an inverted date range', () => {
    const r = toRulePayload({
      ...EMPTY_RULE_FORM,
      value: '-5',
      validFrom: '2026-07-10',
      validUntil: '2026-07-01',
    });
    expect(r.ok).toBe(false);
  });

  it('collects selected days of week', () => {
    const r = toRulePayload({ ...EMPTY_RULE_FORM, value: '-5', daysOfWeek: [1, 3, 5] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.daysOfWeek).toEqual([1, 3, 5]);
  });
});
