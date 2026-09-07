// Tenure-based salary raise for depot heads (Rule-E). Pure, no I/O — drives the
// automatic "kenaikan masa kerja" line in payroll. Non-destructive: the stored
// dailyRate/monthlyRate is the starting rate; the raise is recomputed every
// payroll run from joinDate, so it always tracks current tenure.

const MONTHS_IN_YEAR = 12;

export interface RaiseStep {
  /** Completed years of service required for this step. */
  years: number;
  /** Percent uplift on base pay at this step. */
  pct: number;
}

/**
 * Completed full years of service between joinDate and asOf. An anniversary counts
 * only once the day-of-year is reached (join 2024-03-10 → still 1y on 2026-03-09,
 * 2y on 2026-03-10). Future joinDate or same day → 0.
 */
export function tenureYears(joinDate: Date, asOf: Date): number {
  let years = asOf.getUTCFullYear() - joinDate.getUTCFullYear();
  const beforeAnniversary =
    asOf.getUTCMonth() < joinDate.getUTCMonth() ||
    (asOf.getUTCMonth() === joinDate.getUTCMonth() && asOf.getUTCDate() < joinDate.getUTCDate());
  if (beforeAnniversary) years--;
  return Math.max(0, years);
}

/**
 * Completed whole months of service between joinDate and asOf, counted the way
 * `tenureYears` counts years: the month turns only once the day-of-month is reached
 * (join 2026-03-15 → 0 months on 2026-04-14, 1 month on 2026-04-15). Future joinDate → 0.
 *
 * One definition on purpose. PP 36/2021 prorates THR on masa kerja in whole months, and
 * CA-1-46 prorates the first year's leave on the same count — two rules that disagreed
 * about the same employee's months would be two different answers to "how long have you
 * worked here".
 */
export function tenureMonths(joinDate: Date, asOf: Date): number {
  let months =
    (asOf.getUTCFullYear() - joinDate.getUTCFullYear()) * MONTHS_IN_YEAR +
    (asOf.getUTCMonth() - joinDate.getUTCMonth());
  if (asOf.getUTCDate() < joinDate.getUTCDate()) months--;
  return Math.max(0, months);
}

/**
 * Annual-leave quota for a calendar year (CA-1-46, owner decision 2026-09-04):
 * prorated in the year the employee joined — floor(months worked that year / 12 × quota)
 * — and the full quota every year after. No tenure ladder above that.
 *
 * "Months worked that year" is measured to 1 January of the FOLLOWING year, so a January
 * joiner gets the whole 12; measuring to 31 December would shave the last day off every
 * first year and hand a 1 January joiner 11 days.
 */
export function annualLeaveQuotaFor(fullQuota: number, joinDate: Date, year: number): number {
  const joinYear = joinDate.getUTCFullYear();
  if (year > joinYear) return fullQuota;
  if (year < joinYear) return 0; // a year before the employee existed here
  const months = tenureMonths(joinDate, new Date(Date.UTC(year + 1, 0, 1)));
  return Math.floor((months / MONTHS_IN_YEAR) * fullQuota);
}

/**
 * THR per PP 36/2021 pasal 9 (CA-1-45, owner decision 2026-09-04), followed exactly:
 * 12 months of service or more pays one whole month's wage; 1 to 12 months pays
 * `masa kerja / 12 × 1 bulan upah`; under a month pays nothing.
 *
 * `monthlyWageIdr` is one month's wage BEFORE this month's attendance is considered —
 * PP 36/2021 pays a month of pay, not a share of the month actually worked, so the caller
 * must not hand it the window-prorated base.
 */
export function thrAmount(monthlyWageIdr: number, months: number): number {
  if (months >= MONTHS_IN_YEAR) return Math.round(monthlyWageIdr);
  if (months < 1) return 0;
  return Math.round((monthlyWageIdr * months) / MONTHS_IN_YEAR);
}

/**
 * Parse a raise ladder CSV ("1:5,2:10,3:15" = 1y→+5%, 2y→+10%, 3y→+15%) into steps
 * sorted ascending by years. Malformed / negative entries are dropped; "" → [].
 */
export function parseRaiseLadder(csv: string): RaiseStep[] {
  const steps: RaiseStep[] = [];
  for (const part of csv.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [yStr, pStr] = trimmed.split(':');
    if (yStr === undefined || yStr.trim() === '') continue; // ":7" — Number('') is 0, must not pass
    const y = Number(yStr.trim());
    const p = Number((pStr ?? '').trim());
    if (
      Number.isInteger(y) &&
      y >= 0 &&
      Number.isFinite(p) &&
      p >= 0 &&
      pStr !== undefined &&
      pStr.trim() !== ''
    ) {
      steps.push({ years: y, pct: p });
    }
  }
  return steps.sort((a, b) => a.years - b.years);
}

/**
 * Percent uplift for a given tenure: the highest ladder step whose `years` requirement
 * is met. Empty ladder or tenure below the first step → 0.
 */
export function tenureRaisePercent(ladder: RaiseStep[], years: number): number {
  let pct = 0;
  for (const step of ladder) {
    if (years >= step.years) pct = step.pct;
    else break; // ladder is sorted ascending; no later step can qualify
  }
  return pct;
}
