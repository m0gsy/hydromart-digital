import {
  evalBonusRule,
  metricValue,
  type BonusContext,
  type BonusRuleSpec,
} from '../../src/domain/bonus-rules';

const ctx = (over: Partial<BonusContext> = {}): BonusContext => ({
  presentDays: 26,
  workingDays: 26,
  lateDays: 0,
  isDepotManager: false,
  salesTotal: null,
  basePay: 1_000_000,
  ...over,
});

describe('metricValue', () => {
  it('ATTENDANCE_RATE = present/working * 100, 0 when no working days', () => {
    expect(metricValue('ATTENDANCE_RATE', ctx({ presentDays: 13, workingDays: 26 }))).toBe(50);
    expect(metricValue('ATTENDANCE_RATE', ctx({ workingDays: 0 }))).toBe(0);
  });
  it('ZERO_LATE is 1 only with no late days', () => {
    expect(metricValue('ZERO_LATE', ctx({ lateDays: 0 }))).toBe(1);
    expect(metricValue('ZERO_LATE', ctx({ lateDays: 2 }))).toBe(0);
  });
  it('IS_DEPOT_MANAGER flags managers', () => {
    expect(metricValue('IS_DEPOT_MANAGER', ctx({ isDepotManager: true }))).toBe(1);
    expect(metricValue('IS_DEPOT_MANAGER', ctx())).toBe(0);
  });
  it('SALES_TOTAL passes through null when unwired', () => {
    expect(metricValue('SALES_TOTAL', ctx({ salesTotal: null }))).toBeNull();
    expect(metricValue('SALES_TOTAL', ctx({ salesTotal: 5_000_000 }))).toBe(5_000_000);
  });
});

describe('evalBonusRule', () => {
  const rule = (over: Partial<BonusRuleSpec> = {}): BonusRuleSpec => ({
    metric: 'ATTENDANCE_RATE',
    op: 'GTE',
    threshold: 100,
    rewardKind: 'FIXED',
    rewardValue: 50_000,
    ...over,
  });

  it('pays a FIXED reward when the condition is met', () => {
    expect(evalBonusRule(rule(), ctx())).toBe(50_000); // 100% attendance
  });
  it('pays nothing when the condition is unmet', () => {
    expect(evalBonusRule(rule(), ctx({ presentDays: 20 }))).toBe(0); // 76.9% < 100
  });
  it('PERCENT reward is a percent of base pay', () => {
    expect(evalBonusRule(rule({ rewardKind: 'PERCENT', rewardValue: 5 }), ctx())).toBe(50_000); // 5% of 1,000,000
  });
  it('never pays on an unavailable (null) metric — no sales data → no bonus', () => {
    expect(
      evalBonusRule(
        rule({ metric: 'SALES_TOTAL', op: 'GTE', threshold: 1 }),
        ctx({ salesTotal: null }),
      ),
    ).toBe(0);
  });
  it('depot-manager flat bonus', () => {
    const r = rule({ metric: 'IS_DEPOT_MANAGER', op: 'GTE', threshold: 1, rewardValue: 200_000 });
    expect(evalBonusRule(r, ctx({ isDepotManager: true }))).toBe(200_000);
    expect(evalBonusRule(r, ctx({ isDepotManager: false }))).toBe(0);
  });
});
