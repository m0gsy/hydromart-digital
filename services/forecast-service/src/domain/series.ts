import { zoneOffsetMs } from '@hydromart/platform';

const MS_PER_DAY = 86_400_000;

/**
 * Day number for a Date, counted in the BUSINESS zone (C2).
 *
 * Every demand and revenue cell is keyed by this, and the forecast reads its own "today"
 * the same way — so cutting on UTC filed an order placed at 01:00 WIB against yesterday's
 * demand, and for the first seven hours of every day the forecast's "today" was the day
 * before. A depot was restocked against a series shifted by one day.
 *
 * It replaces `toUtcDay` rather than sitting beside it: two day-numbering schemes in one
 * table is the bug, not the fix. Rows written before this change keep their old key, so
 * the history has a one-day seam at the release — it ages out of the moving-average window
 * within `historyDays`.
 */
export function toBusinessDay(d: Date, timeZone: string): number {
  return Math.floor((d.getTime() + zoneOffsetMs(d, timeZone)) / MS_PER_DAY);
}

/**
 * The inverse of the `day * MS_PER_DAY` Date the repository stores. Deliberately NOT
 * `toBusinessDay`: that value is already a day NUMBER wearing a Date, so re-applying a zone
 * offset to it would shift it a second time.
 */
export function dateToDay(d: Date): number {
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
