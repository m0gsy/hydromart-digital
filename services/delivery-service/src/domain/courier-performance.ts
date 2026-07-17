// Weekly courier performance windows (design 4c). Weeks are reckoned in WIB
// (Asia/Jakarta, UTC+7, no DST) so a "day" bar lines up with the courier's local
// calendar — a delivery at 23:30 WIB belongs to that day, not the UTC next day.

const WIB_OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface WeekWindow {
  /** UTC instant of 00:00 WIB on the week's first day (inclusive). */
  from: Date;
  /** UTC instant one week later (exclusive). */
  to: Date;
}

/** The WIB week beginning on `weekStartIso` (YYYY-MM-DD, a Monday by convention). */
export function weekWindow(weekStartIso: string): WeekWindow {
  const from = new Date(`${weekStartIso}T00:00:00${WIB_OFFSET}`);
  if (Number.isNaN(from.getTime())) {
    throw new Error(`invalid weekStart: ${weekStartIso}`);
  }
  return { from, to: new Date(from.getTime() + WEEK_MS) };
}

/** The window one week earlier — for week-over-week deltas. */
export function previousWeek(w: WeekWindow): WeekWindow {
  return { from: new Date(w.from.getTime() - WEEK_MS), to: new Date(w.to.getTime() - WEEK_MS) };
}

/** 0..6 index of `at` within the window (0 = the window's first WIB day). */
export function dayIndex(at: Date, from: Date): number {
  const i = Math.floor((at.getTime() - from.getTime()) / DAY_MS);
  return Math.min(6, Math.max(0, i));
}
