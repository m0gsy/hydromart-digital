// Tenure-based salary raise for depot heads (Rule-E). Pure, no I/O — drives the
// automatic "kenaikan masa kerja" line in payroll. Non-destructive: the stored
// dailyRate/monthlyRate is the starting rate; the raise is recomputed every
// payroll run from joinDate, so it always tracks current tenure.

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
    if (Number.isInteger(y) && y >= 0 && Number.isFinite(p) && p >= 0 && pStr !== undefined && pStr.trim() !== '') {
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
