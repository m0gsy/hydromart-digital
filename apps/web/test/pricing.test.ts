import { describe, expect, it } from 'vitest';

import { EMPTY_RULE_FORM, computeEffective, toRulePayload, type RuleForm } from '@/lib/pricing';

describe('computeEffective (mirrors checkout math)', () => {
  it('falls back to the catalog base when there is no override or rule', () => {
    expect(computeEffective(20000)).toMatchObject({ base: 20000, override: null, effective: 20000 });
  });

  it('applies a PERCENT surge off the override, rounded to whole rupiah', () => {
    const r = computeEffective(20000, { sellPrice: 18000, adjustType: 'PERCENT', value: 10 } as any);
    expect(r.effective).toBe(19800); // 18000 * 1.10
  });

  it('applies a FIXED delta off the override', () => {
    const r = computeEffective(20000, { sellPrice: 18000, adjustType: 'FIXED', value: -3000 } as any);
    expect(r.effective).toBe(15000);
  });

  it('floors a deep discount at zero (never negative)', () => {
    const r = computeEffective(20000, { sellPrice: 5000, adjustType: 'FIXED', value: -9000 } as any);
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
