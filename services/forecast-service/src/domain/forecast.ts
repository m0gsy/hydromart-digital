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
};

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
  };
}
