import { addLocalDays, dayStartUtc, localDayKey } from '@hydromart/platform';

import { InstantRange } from '../ports/ai-money-sources.port';
import { DashboardSourcesPort } from '../ports/dashboard-sources.port';
import { AnswerEnvelope, belumAda, ditahan, ok } from './envelope';
import { ResolvedPeriod } from './period';
import { ReadScope } from './scope.service';

/** The most depots one source call takes (every internal route refuses more). */
export const DEPOTS_PER_CALL = 100;
export const DOWN = 'Sumber datanya sedang tidak bisa dibaca; coba lagi nanti.';

/** One run of days during which the same depots were readable: the unit a source is asked in. */
export interface Stretch {
  depotIds: string[];
  /** Calendar days, both included. */
  from: string;
  to: string;
  range: InstantRange;
}

/** What a metric of the franchise and HR groups is handed: the period, the readable scope, and the three ways to answer. */
export interface ReadEnv {
  period: ResolvedPeriod;
  scope: ReadScope;
  /** Today in WIB, `YYYY-MM-DD`. */
  today: string;
  ok: <V>(value: V, label?: string) => AnswerEnvelope<V>;
  none: (reason: string) => AnswerEnvelope<never>;
  held: (reason: string) => AnswerEnvelope<never>;
}

export function makeEnv(metricId: string, unit: string, period: ResolvedPeriod, scope: ReadScope, now: Date): ReadEnv {
  const base = { metricId, period, scope: scope.echo, unit, asOf: now };
  return {
    period,
    scope,
    today: localDayKey(now, period.timeZone),
    ok: (value, label) => ok({ ...base, label }, value),
    none: (reason) => belumAda(base, reason),
    held: (reason) => ditahan(base, reason),
  };
}

/** The scope narrowed to the depots in `ids`, for the envelope's echo of what was really counted. */
export function narrowTo(scope: ReadScope, ids: ReadonlySet<string>): ReadScope {
  const spans = scope.spans.filter((s) => ids.has(s.depotId));
  return {
    spans,
    echo: {
      depotIds: [...ids].sort(),
      legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
    },
  };
}

/** Each depot's granted stretches, grouped by the days they cover, as the instants a source takes. */
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
    range: { from: dayStartUtc(g.from, tz).toISOString(), to: addLocalDays(dayStartUtc(g.to, tz), 1, tz).toISOString() },
  }));
}

export function chunks<T>(items: readonly T[], size = DEPOTS_PER_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Reads a many-depot source once per 100 depots and pools the rows; null if any read fails. */
export async function pooled<T>(depotIds: readonly string[], read: (ids: readonly string[]) => Promise<T[] | null>): Promise<T[] | null> {
  const out: T[] = [];
  for (const part of chunks(depotIds)) {
    const rows = await read(part);
    if (!rows) return null;
    out.push(...rows);
  }
  return out;
}

/**
 * Owner choice 10A: only APPROVED or PAID payslips count. A depot-month is finished when no slip is
 * DRAFT and as many employees have an APPROVED/PAID slip as the month waits for. Any depot not
 * finished makes every payroll-bearing number belum_ada. Returns the reason, or null when finished.
 * (The same rule L-03/L-09 apply, asked per 100 depots.)
 */
export async function payrollUnfinished(depots: DashboardSourcesPort, ids: readonly string[], month: string): Promise<string | null> {
  const rows: Awaited<ReturnType<DashboardSourcesPort['hrSummaryMany']>> = [];
  for (const part of chunks(ids)) rows.push(...(await depots.hrSummaryMany([...part], month)));
  if (rows.some((r) => r === null || [r.payrollDraftCount, r.payrollFinalCount, r.payrollExpectedCount].includes(undefined))) {
    return DOWN;
  }
  const open = rows.filter((r) => r!.payrollDraftCount! > 0 || r!.payrollFinalCount! < r!.payrollExpectedCount!);
  return open.length === 0
    ? null
    : `Gaji bulan ini belum selesai: ${open.length} depot masih punya slip DRAFT atau karyawan yang belum punya slip disetujui/dibayar, jadi angka yang memuat gaji belum bisa dijawab.`;
}
