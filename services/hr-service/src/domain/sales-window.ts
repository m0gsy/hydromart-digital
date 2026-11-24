import { addLocalMonths, dayStartUtc } from '@hydromart/platform';

/**
 * The instants `[from, to)` of the WHOLE WIB calendar month of a 'YYYY-MM' period, for
 * summing order sales (`createdAt` is a real instant). Not `monthRange`: that one is
 * `@db.Date` UTC-midnight days for attendance, and as an instant window it cut the month at
 * 07:00 WIB - the last day's evening and the 1st's first 7 hours were never counted (HD-6 A2).
 */
export function salesWindow(periodMonth: string): { from: Date; to: Date } {
  const from = dayStartUtc(`${periodMonth}-01`);
  return { from, to: addLocalMonths(from, 1) };
}
