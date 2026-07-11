const MS_PER_DAY = 86_400_000;

/** Epoch day number for a Date (UTC midnight buckets). */
export function toUtcDay(d: Date): number {
  return Math.floor(d.getTime() / MS_PER_DAY);
}

/** Shift an epoch day number by n days. */
export function addDays(day: number, n: number): number {
  return day + n;
}

/**
 * Contiguous daily quantities for fromDay..toDay inclusive (oldest->newest),
 * 0 for missing days, summing rows that share a day. Length = toDay - fromDay + 1;
 * [] when toDay < fromDay.
 */
export function denseDailySeries(
  rows: { day: number; quantity: number }[],
  opts: { fromDay: number; toDay: number },
): number[] {
  const { fromDay, toDay } = opts;
  if (toDay < fromDay) return [];
  const out = new Array<number>(toDay - fromDay + 1).fill(0);
  for (const r of rows) {
    const i = r.day - fromDay;
    if (i < 0 || i >= out.length) continue; // outside window
    out[i] += r.quantity;
  }
  return out;
}
