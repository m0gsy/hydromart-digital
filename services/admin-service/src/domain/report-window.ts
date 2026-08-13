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
 * UTC on purpose, matching the rest of admin-service's sweeps: the boundary belongs to the
 * schedule, not to a reader's timezone, and a WIB-vs-UTC boundary here would only move
 * which side of midnight a row lands on, not what the report means.
 */
export function reportWindow(cadence: ReportCadence, now: Date): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  switch (cadence) {
    case ReportCadence.MONTHLY:
      return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
    case ReportCadence.WEEKLY: {
      // Week starts Monday. getUTCDay() is 0 for Sunday, so Sunday is 7 days back, not 0.
      const daysSinceMonday = (now.getUTCDay() + 6) % 7;
      const thisMonday = Date.UTC(y, m, d - daysSinceMonday);
      return { from: new Date(thisMonday - 7 * 86_400_000), to: new Date(thisMonday) };
    }
    default:
      return { from: new Date(Date.UTC(y, m, d - 1)), to: new Date(Date.UTC(y, m, d)) };
  }
}

/** The next boundary after `now` for a cadence — the moment the schedule is due again. */
export function nextRunAfter(cadence: ReportCadence, now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  switch (cadence) {
    case ReportCadence.MONTHLY:
      return new Date(Date.UTC(y, m + 1, 1));
    case ReportCadence.WEEKLY: {
      const daysSinceMonday = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(y, m, d - daysSinceMonday + 7));
    }
    default:
      return new Date(Date.UTC(y, m, d + 1));
  }
}
