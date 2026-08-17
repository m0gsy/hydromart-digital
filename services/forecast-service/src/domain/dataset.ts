/**
 * PR-J, part one: the supervised dataset the forecaster does not use yet.
 *
 * Everything downstream of this file — a fitted model, a backtest, a comparison against
 * the moving average — needs the same thing first: the daily series turned into rows of
 * (features seen on day D) → (what actually sold on day D+1). Writing that once, in the
 * domain, is what makes the rest possible without touching the service.
 *
 * Deliberately NOT fitted here. A model trained on this repo's current data would be
 * trained on a few weeks of one depot's sales, which is how you ship a model that is
 * confidently worse than an average. The machinery is the deliverable; the fit waits for
 * data worth fitting.
 */

/**
 * Feature order, exported because it is a CONTRACT: any fitted model's coefficients are
 * meaningless against a different order, and the day the two disagree silently is the day
 * the forecast quietly becomes noise.
 */
export const FEATURE_NAMES = [
  'lag1',
  'lag2',
  'lag3',
  'lag7',
  'windowMean',
  'windowSlope',
  'nonZeroShare',
  'isWeekend',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export interface DatasetRow {
  /** Business-day number the label belongs to (the day being predicted). */
  day: number;
  features: number[];
  label: number;
}

/** Callers here always pass a window of at least one day, so there is no empty case to guard. */
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Least-squares slope over 0..n-1. 0 for fewer than two points, where it is undefined. */
function slope(xs: number[]): number {
  const n = xs.length;
  // Below two points the denominator is 0; above it, it cannot be — so this guard is the
  // whole of the division safety, and a second check downstream would be unreachable.
  if (n < 2) return 0;
  const xBar = (n - 1) / 2;
  const yBar = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xBar) * (xs[i] - yBar);
    den += (i - xBar) ** 2;
  }
  return num / den;
}

/**
 * Business-day numbers are days since an epoch, so `% 7` is a stable weekday index — no
 * timezone maths, and no Date object anywhere near a pure function.
 *
 * Which two indices are the weekend depends on that epoch's alignment, so it is a
 * parameter with a default rather than a fact this file invents. Water sells differently
 * on a Sunday; the feature exists so a model can find that out for itself.
 */
export const WEEKEND_DAYS = [5, 6];

export interface DatasetOptions {
  /** First business day of `series` — every row's `day` is derived from it. */
  startDay: number;
  /** How many past days a row may look at. Rows before this are not emitted. */
  lookback?: number;
  weekendDays?: number[];
}

/**
 * Walk the series and emit one row per predictable day. A row NEVER reads a value at or
 * after its own label — the single mistake that makes an offline evaluation look
 * brilliant and a live forecast look broken.
 */
export function buildDataset(series: number[], options: DatasetOptions): DatasetRow[] {
  const lookback = Math.max(1, options.lookback ?? 7);
  const weekend = options.weekendDays ?? WEEKEND_DAYS;
  const rows: DatasetRow[] = [];
  for (let i = lookback; i < series.length; i++) {
    const window = series.slice(i - lookback, i);
    const day = options.startDay + i;
    rows.push({
      day,
      features: [
        series[i - 1],
        series[i - 2] ?? 0,
        series[i - 3] ?? 0,
        series[i - 7] ?? 0,
        mean(window),
        slope(window),
        window.filter((v) => v > 0).length / window.length,
        weekend.includes(((day % 7) + 7) % 7) ? 1 : 0,
      ],
      label: series[i],
    });
  }
  return rows;
}

/**
 * Split by TIME, never at random. A random split lets a row from March predict February,
 * which is a number no production forecast can ever reproduce.
 */
export function splitByTime(
  rows: DatasetRow[],
  trainShare = 0.7,
): { train: DatasetRow[]; test: DatasetRow[] } {
  const cut = Math.floor(rows.length * Math.min(Math.max(trainShare, 0), 1));
  return { train: rows.slice(0, cut), test: rows.slice(cut) };
}
