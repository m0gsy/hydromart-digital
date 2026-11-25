import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser, addLocalDays, dayStartUtc, localDayKey } from '@hydromart/platform';

import { SourceSpan } from '../ports/ai-customer-sources.port';
import { AnswerEnvelope, belumAda, ditahan, ok } from './envelope';
import { PeriodQuery, ResolvedPeriod, parsePeriod } from './period';
import { ReadScope, ReadScopeService } from './scope.service';

/** What one metric of a group says about itself. */
export interface GroupMetricMeta {
  unit: string;
  /** Only defined over whole calendar months (a run of them): the period must be one. */
  month?: boolean;
  /**
   * Counts people, so only ONE whole calendar month may be asked. Two answers then never overlap,
   * and no two of them can be subtracted to isolate the few people between a month and a week.
   */
  oneMonth?: boolean;
}

export interface GroupCtx {
  user: AuthenticatedUser;
  period: ResolvedPeriod;
  scope: ReadScope;
  now: Date;
  /** Today in WIB, `YYYY-MM-DD`. */
  today: string;
  ok: <V>(value: V, label?: string) => AnswerEnvelope<V>;
  none: (reason: string) => AnswerEnvelope<never>;
  held: (reason: string) => AnswerEnvelope<never>;
}

export const DOWN = 'Sumber datanya sedang tidak bisa dibaca; coba lagi nanti.';
export const NO_SCOPE = 'Tidak ada depot yang boleh Anda baca pada periode ini.';
export const TOO_MANY = 'Terlalu banyak depot untuk dihitung sekaligus dalam satu jawaban; persempit cakupan atau periode.';
export const SMALL_GROUP_REASON = 'kurang dari 3: kelompok sekecil ini tidak dijawab dengan angkanya, supaya tidak menunjuk satu atau dua orang.';

/** Most depots, and most spans, one many-depot read may carry. Past it the answer is belum_ada, never a cut. */
export const MAX_READ_DEPOTS = 100;
export const MAX_READ_SPANS = 200;

/** Resolves period and scope for one metric of a group and hands back the three envelope makers. */
export async function openGroup(
  scopes: ReadScopeService,
  registry: Record<string, GroupMetricMeta>,
  group: string,
  metricId: string,
  user: AuthenticatedUser,
  query: PeriodQuery,
  now: Date,
): Promise<GroupCtx> {
  if (!Object.prototype.hasOwnProperty.call(registry, metricId)) {
    throw new NotFoundException(`Metrik ${group} ini tidak ada di kamus.`);
  }
  const meta = registry[metricId];
  const period = parsePeriod(query, now, meta.month ? { whole: 'month' } : {});
  // A named day or week is never a whole month (even one inside a month), and a named year only fits a metric that may span months.
  const unitOk = !meta.month || period.unit === 'month' || period.unit === 'range' || (period.unit === 'year' && !meta.oneMonth);
  if (!unitOk || (meta.oneMonth && period.from.slice(0, 7) !== period.to.slice(0, 7))) {
    throw new BadRequestException(`${metricId} hanya untuk ${meta.oneMonth ? 'satu bulan penuh' : 'bulan penuh'}`);
  }
  const scope = await scopes.resolve(user, period);
  const base = { metricId, period, scope: scope.echo, unit: meta.unit, asOf: now };
  return {
    user,
    period,
    scope,
    now,
    today: localDayKey(now, period.timeZone),
    ok: <V>(value: V, label?: string) => ok({ ...base, label }, value),
    none: (reason: string) => belumAda(base, reason),
    held: (reason: string) => ditahan(base, reason),
  };
}

/** The granted stretches as the instants a source takes, one entry per (depot, stretch). */
export function sourceSpans(scope: ReadScope, timeZone: string): SourceSpan[] {
  return scope.spans.map((s) => ({
    depotId: s.depotId,
    from: dayStartUtc(s.from, timeZone).toISOString(),
    to: addLocalDays(dayStartUtc(s.to, timeZone), 1, timeZone).toISOString(),
  }));
}

/** Whether one many-depot read can carry the spans; a distinct count cannot be split across reads. */
export const fitsOneRead = (spans: readonly SourceSpan[]): boolean =>
  spans.length <= MAX_READ_SPANS && new Set(spans.map((s) => s.depotId)).size <= MAX_READ_DEPOTS;

/**
 * A count of people as an answer: 0 is a real answer; 1 or 2 is a group too small to name, so the
 * number is held back (never shown, never turned into 0).
 */
export function peopleCount(c: GroupCtx, people: number, label: string): AnswerEnvelope {
  return people > 0 && people < 3 ? c.held(SMALL_GROUP_REASON) : c.ok(people, label);
}
