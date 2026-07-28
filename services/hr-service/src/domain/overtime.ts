// Overtime math (M24-17). Pure, no I/O — this is wages, so every rule is testable
// in isolation and none of it depends on Prisma or Nest.

/** One attended day, as payroll sees it. */
export interface WorkedDay {
  /** UTC YYYY-MM-DD, matching how @db.Date rows are stored. */
  workDate: string;
  /** Minutes between check-in and check-out; null when the day was never closed out. */
  workingMinutes: number | null;
}

export interface OvertimeRates {
  /** Minutes that count as a normal day before overtime starts. */
  standardWorkingMinutes: number;
  /** Multiplier on the hourly rate for overtime on an ordinary working day. */
  multiplier: number;
  /**
   * Multiplier for work on a weekly-off day or a national holiday. M24-17 requires a
   * national holiday to be treated exactly like a weekly off day, so both feed this
   * one rate rather than a third, separate one.
   */
  offDayMultiplier: number;
}

export interface OvertimeBreakdown {
  /** Overtime minutes worked on ordinary working days. */
  regularMinutes: number;
  /** Overtime minutes worked on weekly-off days or national holidays. */
  offDayMinutes: number;
  totalMinutes: number;
}

/**
 * Split attended days into ordinary and off-day overtime.
 *
 * On an ordinary day only the minutes ABOVE the standard shift are overtime. On a
 * weekly-off day or a national holiday the employee was not expected at all, so every
 * worked minute is overtime — that is what "libur nasional diperlakukan sebagai libur
 * mingguan" means in payroll terms.
 *
 * Days that were never checked out (workingMinutes null) contribute nothing: guessing
 * an end time would invent wages.
 */
export function splitOvertime(
  days: readonly WorkedDay[],
  standardWorkingMinutes: number,
  isOffDay: (workDate: string) => boolean,
): OvertimeBreakdown {
  let regularMinutes = 0;
  let offDayMinutes = 0;
  for (const day of days) {
    const worked = day.workingMinutes ?? 0;
    if (worked <= 0) continue;
    if (isOffDay(day.workDate)) {
      offDayMinutes += worked;
    } else {
      regularMinutes += Math.max(0, worked - standardWorkingMinutes);
    }
  }
  return { regularMinutes, offDayMinutes, totalMinutes: regularMinutes + offDayMinutes };
}

/**
 * Rupiah per minute of ordinary work.
 *
 * MONTHLY staff: the monthly wage spread over the days they were expected to work and
 * the standard shift length. DAILY staff: the day rate over one standard shift.
 * Returns 0 rather than Infinity when the divisor is missing, so a misconfigured depot
 * pays no overtime instead of an unbounded amount.
 */
export function minuteRate(
  salaryType: 'MONTHLY' | 'DAILY',
  monthlyRate: number,
  dailyRate: number,
  workingDays: number,
  standardWorkingMinutes: number,
): number {
  if (standardWorkingMinutes <= 0) return 0;
  if (salaryType === 'DAILY') return dailyRate / standardWorkingMinutes;
  if (workingDays <= 0) return 0;
  return monthlyRate / (workingDays * standardWorkingMinutes);
}

/** Overtime pay in whole rupiah, rounded once at the end so the two rates don't drift. */
export function overtimePay(
  breakdown: OvertimeBreakdown,
  perMinute: number,
  rates: Pick<OvertimeRates, 'multiplier' | 'offDayMultiplier'>,
): number {
  if (perMinute <= 0) return 0;
  const raw =
    breakdown.regularMinutes * perMinute * rates.multiplier +
    breakdown.offDayMinutes * perMinute * rates.offDayMultiplier;
  return Math.round(raw);
}

/** "2j 30m" for the salary-slip line; minutes-only below an hour. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}j` : `${hours}j ${rest}m`;
}
