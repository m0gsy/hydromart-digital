import { movingAverage } from './moving-average';
import { linearTrend, projectAt } from './trend';

/** Floor a value at 0 (demand is never negative). */
export function clampNonNeg(n: number): number {
  return Math.max(0, n);
}

export type Forecast = {
  avgDaily: number;
  trendSlope: number;
  predictedDaily: number[];
  predictedTotal: number;
  reorderSuggestion: number;
  confidence: number; // 0..1 — trust in the projection given history density/stability/length
};

/**
 * How much to trust a forecast, 0..1, from the history alone: demand density (how many
 * days had any sale), stability (low coefficient of variation), and sample sufficiency
 * (full weight at >= 14 days). Sparse, spiky, or short history all pull confidence down.
 */
export function forecastConfidence(series: number[]): number {
  const n = series.length;
  if (n === 0) return 0;
  const nonZero = series.filter((v) => v > 0).length;
  const coverage = nonZero / n;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let stability = 0;
  if (mean > 0) {
    const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const cv = Math.sqrt(variance) / mean; // coefficient of variation
    stability = clampNonNeg(1 - Math.min(cv, 1));
  }
  const sample = Math.min(n / 14, 1); // damp short histories
  const raw = (0.5 * coverage + 0.5 * stability) * sample;
  return Math.round(Math.min(clampNonNeg(raw), 1) * 100) / 100;
}

/**
 * Heuristic demand forecast: moving-average level + linear trend projection, blended
 * toward the average when history is short/noisy (n < maWindow*2) so it degrades to the
 * mean rather than a wild extrapolation. Predicted days are non-negative integers.
 */
export function forecastDemand(
  series: number[],
  opts: { horizonDays: number; maWindow: number },
): Forecast {
  const n = series.length;
  const avgDaily = movingAverage(series, opts.maWindow);
  const trend = linearTrend(series);
  const blend = n < opts.maWindow * 2; // short/noisy history -> lean on the average

  const predictedDaily: number[] = [];
  for (let k = 0; k < opts.horizonDays; k++) {
    const proj = projectAt(trend, n + k);
    const raw = blend ? 0.5 * proj + 0.5 * avgDaily : proj;
    predictedDaily.push(clampNonNeg(Math.round(raw)));
  }

  const predictedTotal = predictedDaily.reduce((a, b) => a + b, 0);
  return {
    avgDaily,
    trendSlope: trend.slope,
    predictedDaily,
    predictedTotal,
    reorderSuggestion: predictedTotal, // ceiling: horizon demand, ignores on-hand stock
    confidence: forecastConfidence(series),
  };
}
