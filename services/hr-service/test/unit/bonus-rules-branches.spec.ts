import { evalBonusRule, metricValue, type BonusContext, type BonusMetric } from '../../src/domain/bonus-rules';

// Gap-fill for bonus-rules: PRESENT_DAYS metric, unknown-metric default, and the LTE / EQ /
// default compare operators the primary spec never exercises.

const ctx = (over: Partial<BonusContext> = {}): BonusContext => ({
  presentDays: 22,
  workingDays: 26,
  lateDays: 1,
  isDepotManager: false,
  salesTotal: null,
  basePay: 1_000_000,
  ...over,
});

describe('metricValue — remaining metrics', () => {
  it('PRESENT_DAYS returns the raw present-day count', () => {
    expect(metricValue('PRESENT_DAYS', ctx({ presentDays: 22 }))).toBe(22);
  });

  it('unknown metric resolves to null (default branch)', () => {
    expect(metricValue('NOT_A_METRIC' as BonusMetric, ctx())).toBeNull();
  });
});

describe('evalBonusRule — compare operators', () => {
  it('LTE pays when value <= threshold and not otherwise', () => {
    // lateDays 1 -> ZERO_LATE metric value 0; LTE 0 is met, LTE -1 is not.
    const base = { metric: 'ZERO_LATE' as BonusMetric, rewardKind: 'FIXED' as const, rewardValue: 5_000 };
    expect(evalBonusRule({ ...base, op: 'LTE', threshold: 0 }, ctx({ lateDays: 1 }))).toBe(5_000);
    expect(evalBonusRule({ ...base, op: 'LTE', threshold: -1 }, ctx({ lateDays: 1 }))).toBe(0);
  });

  it('EQ pays only on an exact match', () => {
    const base = { metric: 'PRESENT_DAYS' as BonusMetric, rewardKind: 'FIXED' as const, rewardValue: 7_000 };
    expect(evalBonusRule({ ...base, op: 'EQ', threshold: 22 }, ctx({ presentDays: 22 }))).toBe(7_000);
    expect(evalBonusRule({ ...base, op: 'EQ', threshold: 21 }, ctx({ presentDays: 22 }))).toBe(0);
  });

  it('an unknown operator never pays (default compare branch)', () => {
    expect(
      evalBonusRule(
        { metric: 'PRESENT_DAYS', op: 'NEQ' as 'EQ', threshold: 22, rewardKind: 'FIXED', rewardValue: 9_000 },
        ctx({ presentDays: 22 }),
      ),
    ).toBe(0);
  });
});
