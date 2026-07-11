/** Mean of the last `window` values (all if series shorter, or window<=0). 0 for empty series. */
export function movingAverage(series: number[], window: number): number {
  if (series.length === 0) return 0;
  const w = window > 0 ? Math.min(window, series.length) : series.length;
  const slice = series.slice(series.length - w);
  return slice.reduce((a, b) => a + b, 0) / w;
}
