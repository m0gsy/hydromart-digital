// Working-day calendar math. Pure, no I/O — drives auto-absence in payroll.

/** UTC YYYY-MM-DD for a day-of-month, matching how @db.Date rows are stored. */
function isoDay(year: number, month1to12: number, day: number): string {
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Count working days in a month: every calendar day EXCEPT weekly-off weekdays
 * (0=Sun..6=Sat) and dated holidays (ISO YYYY-MM-DD). Returns the number of days an
 * employee is expected to be present, so payroll can derive absentDays.
 */
export function workingDaysInMonth(
  year: number,
  month1to12: number,
  holidays: ReadonlySet<string>,
  weeklyOffDays: ReadonlySet<number>,
): number {
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = isoDay(year, month1to12, day);
    const weekday = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
    if (weeklyOffDays.has(weekday)) continue;
    if (holidays.has(iso)) continue;
    count++;
  }
  return count;
}

/** Parse a CSV of weekday indices ("0,6") into a Set, ignoring blanks/out-of-range. */
export function parseWeeklyOffDays(csv: string): Set<number> {
  const out = new Set<number>();
  for (const part of csv.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue; // Number('') is 0 — a blank must not add Sunday.
    const n = Number(trimmed);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return out;
}
