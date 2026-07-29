/**
 * Turning a month of raw HR facts into one number a manager can defend.
 *
 * Three components, each 0–100 and each independently *unmeasurable*: a month with no
 * scheduled working days has no attendance rate, somebody who never showed up has no
 * lateness rate, and a depot with no sales target has nothing to score sales against.
 *
 * An unmeasurable component is null, not zero. Scoring it zero would punish an employee for
 * a figure nobody collected — so the weights of the components that DID measure are
 * renormalised instead, and the final score stays on the same 0–100 scale either way.
 */

export interface ScoreWeights {
  attendance: number;
  discipline: number;
  sales: number;
}

export interface ScoreInputs {
  /** Days actually attended (LATE counts as present — it is lateness, not absence). */
  presentDays: number;
  lateDays: number;
  /** Scheduled working days in the period, holidays and weekly-off already removed. */
  workingDays: number;
  /** Depot sales for the period, or null when order-service could not be reached. */
  salesTotal: number | null;
  /** Configured monthly target; 0 means "no target set", not "target of nothing". */
  salesTarget: number;
}

export interface PerformanceScore {
  attendance: number | null;
  discipline: number | null;
  sales: number | null;
  /** Weighted mean of the measured components, or null when none could be measured. */
  final: number | null;
  /** What each component actually counted for, after dropping the unmeasured ones. */
  effectiveWeights: ScoreWeights;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  attendance: 40,
  discipline: 30,
  sales: 30,
};

const clamp = (n: number): number => Math.min(100, Math.max(0, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Share of the scheduled working days that were attended. */
export function attendanceScore(presentDays: number, workingDays: number): number | null {
  if (workingDays <= 0) return null;
  return round2(clamp((presentDays / workingDays) * 100));
}

/**
 * How much of the attendance was punctual. Measured against days ATTENDED, not days
 * scheduled: being absent is an attendance failure and is already scored there — counting it
 * twice would make one missed day cost double.
 */
export function disciplineScore(presentDays: number, lateDays: number): number | null {
  if (presentDays <= 0) return null;
  return round2(clamp(100 - (lateDays / presentDays) * 100));
}

/** Attainment against the target, capped at 100 — overshooting is not extra credit here. */
export function salesScore(salesTotal: number | null, salesTarget: number): number | null {
  if (salesTotal === null || salesTarget <= 0) return null;
  return round2(clamp((salesTotal / salesTarget) * 100));
}

export function computePerformanceScore(
  inputs: ScoreInputs,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): PerformanceScore {
  const components = {
    attendance: attendanceScore(inputs.presentDays, inputs.workingDays),
    discipline: disciplineScore(inputs.presentDays, inputs.lateDays),
    sales: salesScore(inputs.salesTotal, inputs.salesTarget),
  };

  // A negative weight would let a good component drag the score down; treat it as unset.
  const effectiveWeights: ScoreWeights = {
    attendance: components.attendance === null ? 0 : Math.max(0, weights.attendance),
    discipline: components.discipline === null ? 0 : Math.max(0, weights.discipline),
    sales: components.sales === null ? 0 : Math.max(0, weights.sales),
  };

  const total = effectiveWeights.attendance + effectiveWeights.discipline + effectiveWeights.sales;
  if (total <= 0) return { ...components, final: null, effectiveWeights };

  const weighted =
    (components.attendance ?? 0) * effectiveWeights.attendance +
    (components.discipline ?? 0) * effectiveWeights.discipline +
    (components.sales ?? 0) * effectiveWeights.sales;

  return { ...components, final: round2(weighted / total), effectiveWeights };
}
