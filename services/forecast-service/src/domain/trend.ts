export type Trend = { slope: number; intercept: number };

/**
 * Least-squares fit over points (index i, series[i]) -> { slope, intercept }.
 * <2 points: slope 0, intercept = series[0] ?? 0.
 */
export function linearTrend(series: number[]): Trend {
  const n = series.length;
  if (n < 2) return { slope: 0, intercept: series[0] ?? 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += series[i];
    sumXY += i * series[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n }; // guard (unreachable for x=index, n>=2)
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Value the trend line predicts at a given index. */
export function projectAt(trend: Trend, index: number): number {
  return trend.intercept + trend.slope * index;
}
