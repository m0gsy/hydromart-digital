import { addLocalDays, dayStartUtc } from '@hydromart/platform';

import { InstantRange } from '../ports/ai-money-sources.port';
import { ResolvedPeriod } from './period';
import { ReadScope } from './scope.service';

/** One run of days during which the same depots were readable: the unit a source is asked in. */
export interface Stretch {
  depotIds: string[];
  /** The days, `YYYY-MM-DD`, both included. */
  from: string;
  to: string;
  range: InstantRange;
}

/** Depots per call to a source that takes a list. */
export const DEPOTS_PER_READ = 100;

/**
 * Each depot's granted stretches, grouped by the days they cover, as the instants a source takes.
 * A depot that changed legal entity mid-period appears only in the stretch it was readable in.
 */
export function stretchesOf(scope: ReadScope, period: ResolvedPeriod): Stretch[] {
  const groups = new Map<string, { from: string; to: string; depotIds: Set<string> }>();
  for (const s of scope.spans) {
    const key = `${s.from}|${s.to}`;
    const g = groups.get(key) ?? { from: s.from, to: s.to, depotIds: new Set<string>() };
    g.depotIds.add(s.depotId);
    groups.set(key, g);
  }
  const tz = period.timeZone;
  return [...groups.values()].map((g) => ({
    depotIds: [...g.depotIds].sort(),
    from: g.from,
    to: g.to,
    range: {
      from: dayStartUtc(g.from, tz).toISOString(),
      to: addLocalDays(dayStartUtc(g.to, tz), 1, tz).toISOString(),
    },
  }));
}

/** Depots readable on one day (`YYYY-MM-DD`), for a metric that is only about "now". */
export function depotsOn(scope: ReadScope, day: string): string[] {
  return [...new Set(scope.spans.filter((s) => s.from <= day && day <= s.to).map((s) => s.depotId))].sort();
}

/** The day `n` days after `day` (calendar arithmetic on `YYYY-MM-DD`). */
export function plusDays(day: string, n: number): string {
  // tz-ok: calendar days held as UTC midnights; the UTC slice IS the calendar day.
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); // tz-ok: a calendar day
}
