import { can } from '@hydromart/access';

import { MONTHS, wibDate } from './morning-summary';

/** AI-26: the dedupe base of the weekly Sales report notice is `sales-weekly:<Monday, WIB>`. */
export const SALES_WEEKLY_PREFIX = 'sales-weekly:';

/** Roles that always read the calon mitra reports; any other role needs `prospectSettings` (Sales Lead). */
const FIXED_ROLES: readonly string[] = ['MARKETING', 'DIREKTUR'];

/** A role that is told: MARKETING, DIREKTUR, or any role (custom included) that holds `prospectSettings`. */
export const isSalesReportRole = (role: string): boolean =>
  FIXED_ROLES.includes(role) || can('prospectSettings', role);

const DAY_MS = 86_400_000;
const epochDay = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
};

/**
 * Why `weekStart` may not be reported on `now`, or null when it may: it must be a real Monday and
 * the week that just ended, still accepted until that week's own Sunday so a late retry works.
 */
export function weekRefusal(weekStart: string, now: Date): string | null {
  const start = epochDay(weekStart);
  // 1970-01-01 (day 0) was a Thursday, so a Monday is day 4 mod 7. Date.UTC rolls 31 Feb over, which the round trip catches.
  // tz-ok: `start` is a WIB calendar day held as UTC midnight (epochDay), not an instant: the slice reads that same day back.
  if (new Date(start * DAY_MS).toISOString().slice(0, 10) !== weekStart) return 'weekStart is not a calendar day';
  if (((start % 7) + 7) % 7 !== 4) return 'weekStart must be a Monday';
  const sinceStart = epochDay(wibDate(now)) - start;
  return sinceStart >= 7 && sinceStart <= 13 ? null : 'weekStart must be the week that just ended (Asia/Jakarta)';
}

const dayMonth = (day: string): string => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** "23 Nov - 29 Nov": the Monday and the Sunday that closes it. */
export function weekLabel(weekStart: string): string {
  // tz-ok: calendar-day arithmetic on a WIB day held as UTC midnight (epochDay); no instant is converted.
  const sunday = new Date((epochDay(weekStart) + 6) * DAY_MS).toISOString().slice(0, 10);
  return `${dayMonth(weekStart)} - ${dayMonth(sunday)}`;
}
