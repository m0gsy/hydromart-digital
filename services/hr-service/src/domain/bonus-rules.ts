// Configurable bonus rule engine (Rule-F). Pure, no I/O — drives the automatic BONUS
// lines in payroll from admin-defined rules, alongside the manual Bonus table.
//
// A rule reads ONE metric of the employee's month, compares it to a threshold, and — if
// met — pays a reward that is either a fixed IDR amount or a percent of base pay.

export type BonusMetric =
  | 'ATTENDANCE_RATE' // percent of working days present (0..100)
  | 'PRESENT_DAYS' // count of days present
  | 'ZERO_LATE' // 1 if never late this month, else 0
  | 'IS_DEPOT_MANAGER' // 1 if employmentStatus = DEPOT_MANAGER, else 0
  | 'SALES_TOTAL'; // IDR sales attributed this month — cross-service, null until wired

export type CompareOp = 'GTE' | 'LTE' | 'EQ';
export type RewardKind = 'FIXED' | 'PERCENT'; // PERCENT = of base pay

export interface BonusRuleSpec {
  metric: BonusMetric;
  op: CompareOp;
  threshold: number;
  rewardKind: RewardKind;
  rewardValue: number;
}

export interface BonusContext {
  presentDays: number;
  workingDays: number;
  lateDays: number;
  isDepotManager: boolean;
  /** null = sales aggregate not wired yet → SALES_TOTAL rules are skipped (never pay on unknown). */
  salesTotal: number | null;
  basePay: number;
}

/** Resolve a metric's numeric value, or null when the metric's data is unavailable. */
export function metricValue(metric: BonusMetric, ctx: BonusContext): number | null {
  switch (metric) {
    case 'ATTENDANCE_RATE':
      return ctx.workingDays > 0 ? (ctx.presentDays / ctx.workingDays) * 100 : 0;
    case 'PRESENT_DAYS':
      return ctx.presentDays;
    case 'ZERO_LATE':
      return ctx.lateDays === 0 ? 1 : 0;
    case 'IS_DEPOT_MANAGER':
      return ctx.isDepotManager ? 1 : 0;
    case 'SALES_TOTAL':
      return ctx.salesTotal; // null → unmet (see evalBonusRule)
    default:
      return null;
  }
}

function compare(value: number, op: CompareOp, threshold: number): boolean {
  switch (op) {
    case 'GTE':
      return value >= threshold;
    case 'LTE':
      return value <= threshold;
    case 'EQ':
      return value === threshold;
    default:
      return false;
  }
}

/**
 * Bonus amount (rounded IDR) a rule pays for this month; 0 if the condition is unmet or the
 * metric's data is unavailable. PERCENT rewards are a percent of base pay.
 */
export function evalBonusRule(spec: BonusRuleSpec, ctx: BonusContext): number {
  const value = metricValue(spec.metric, ctx);
  if (value === null) return 0; // unknown metric data never pays a bonus
  if (!compare(value, spec.op, spec.threshold)) return 0;
  const amount = spec.rewardKind === 'PERCENT' ? (ctx.basePay * spec.rewardValue) / 100 : spec.rewardValue;
  return Math.max(0, Math.round(amount));
}
