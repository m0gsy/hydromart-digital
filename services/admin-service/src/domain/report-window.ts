import {
  BUSINESS_TIME_ZONE,
  addLocalDays,
  addLocalMonths,
  localDayKey,
  startOfLocalDay,
  startOfLocalMonth,
} from '@hydromart/platform';

import { ReportCadence } from './report-cadence';

/**
 * The window a cadence reports on, and when it next comes due.
 *
 * Both are derived from ONE instant so a run cannot report on a period it is not scheduled
 * for. A daily report fired on the 3rd covers the 2nd — the day that finished — not the
 * partial day it is running inside; the same rule gives a weekly report last week and a
 * monthly report last month. Reporting on the current period would produce a file whose
 * numbers change every time it is generated, which is the one thing a scheduled report
 * must not do.
 *
 * Every boundary is a BUSINESS-calendar (WIB) midnight, returned as the UTC instant it
 * happens at. This used to be UTC midnight, with a note that the choice "would only move which
 * side of midnight a row lands on, not what the report means". It does move what the report
 * means: the dashboards and every other report here cut the day at 00:00 WIB, so a daily file
 * cut at 07:00 WIB disagreed with the screen it was meant to match for every order placed in
 * between — the same day's revenue read differently depending on which one asked.
 */
export function reportWindow(
  cadence: ReportCadence,
  now: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): { from: Date; to: Date } {
  switch (cadence) {
    case ReportCadence.MONTHLY:
      return { from: addLocalMonths(now, -1, timeZone), to: startOfLocalMonth(now, timeZone) };
    case ReportCadence.WEEKLY: {
      const thisMonday = mondayStart(now, timeZone);
      return { from: addLocalDays(thisMonday, -7, timeZone), to: thisMonday };
    }
    default:
      return { from: addLocalDays(now, -1, timeZone), to: startOfLocalDay(now, timeZone) };
  }
}

/** The next boundary after `now` for a cadence — the moment the schedule is due again. */
export function nextRunAfter(
  cadence: ReportCadence,
  now: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  switch (cadence) {
    case ReportCadence.MONTHLY:
      return addLocalMonths(now, 1, timeZone);
    case ReportCadence.WEEKLY:
      return addLocalDays(mondayStart(now, timeZone), 7, timeZone);
    default:
      return addLocalDays(now, 1, timeZone);
  }
}

/** Local midnight at the start of the Monday-based week containing `now`, as a UTC instant. */
function mondayStart(now: Date, timeZone: string): Date {
  // tz-ok: the key is a LOCAL calendar date, parsed at UTC midnight only to read its weekday —
  // a date has the same weekday everywhere, so no offset enters the arithmetic.
  const dow = new Date(`${localDayKey(now, timeZone)}T00:00:00.000Z`).getUTCDay();
  // Week starts Monday. getUTCDay() is 0 for Sunday, so Sunday is 6 days back, not 0.
  return addLocalDays(startOfLocalDay(now, timeZone), -((dow + 6) % 7), timeZone);
}
