export interface PeakCell {
  weekday: number;
  hour: number;
  orders: number;
}

/** The weekday-hour with the most orders (the earliest on a tie), or null when there are none. */
export function peakCell(heat: number[][]): PeakCell | null {
  let best: PeakCell | null = null;
  heat.forEach((row, weekday) =>
    row.forEach((orders, hour) => {
      if (orders > 0 && (best == null || orders > best.orders)) best = { weekday, hour, orders };
    }),
  );
  return best;
}

/** The index of the largest value (the first on a tie), or null when all are zero. */
export function peakIndex(values: number[]): number | null {
  let at: number | null = null;
  values.forEach((v, i) => {
    if (v > 0 && (at == null || v > (values[at] ?? 0))) at = i;
  });
  return at;
}
