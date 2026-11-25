import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { AiOrgSourcesPort, DepotTargetRow } from '../ports/ai-org-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { CustomerMetricsService } from './customer-metrics';
import { AnswerEnvelope } from './envelope';
import { GallonMetricsService } from './gallon-metrics';
import { DOWN, GroupMetricMeta, NO_SCOPE, openGroup } from './group-context';
import { MoneyMetricsService } from './money-metrics';
import { PeriodQuery } from './period';
import { ReadScope, ReadScopeService } from './scope.service';
import { DEPOTS_PER_READ, plusDays } from './stretches';

/**
 * HD-16: target versus actual, the monthly goals a depot manager sets (depot-service `DepotTarget`) beside the
 * metric that measures each one. A target metric answers `{ target, actual, pct }` for ONE whole calendar month.
 * The actual is exactly what the base metric answers (same period, scope, masking and "closed month" rules); a
 * target metric never opens a number its base metric holds back.
 */
export const TARGET_METRICS = {
  'T-01': { unit: 'Rp', month: true, oneMonth: true },
  'T-02': { unit: 'galon', month: true, oneMonth: true },
  'T-03': { unit: 'pesanan', month: true, oneMonth: true },
  'T-04': { unit: 'orang', month: true, oneMonth: true },
} as const satisfies Record<string, GroupMetricMeta>;
export type TargetMetricId = keyof typeof TARGET_METRICS;
export const TARGET_METRIC_IDS = Object.keys(TARGET_METRICS) as TargetMetricId[];

type Group = 'money' | 'gallons' | 'customers';
interface TargetSpec {
  /** The metric that measures this goal. */
  actual: string;
  group: Group;
  field: keyof Omit<DepotTargetRow, 'depotId'>;
  what: string;
}
const SPEC: Record<TargetMetricId, TargetSpec> = {
  'T-01': { actual: 'P-01', group: 'money', field: 'revenueTargetIdr', what: 'omzet (P-01)' },
  'T-02': { actual: 'G-01', group: 'gallons', field: 'gallonsTarget', what: 'galon terjual (G-01)' },
  'T-03': { actual: 'P-04', group: 'money', field: 'ordersTarget', what: 'jumlah pesanan tidak batal (P-04: bukan BATAL/VOID, bukan hanya yang terkirim, menurut tanggal pesanan dibuat; angka yang sama dengan bar pesanan di halaman target depot)' },
  'T-04': { actual: 'C-01', group: 'customers', field: 'newCustomersTarget', what: 'pelanggan baru (C-01)' },
};

/** One depot's stretches (a legal-entity change splits one into two) leave no day of the period uncovered. */
function coversWholePeriod(spans: ReadScope['spans'], depotId: string, from: string, to: string): boolean {
  let next = from;
  for (const s of spans.filter((x) => x.depotId === depotId).sort((x, y) => (x.from < y.from ? -1 : 1))) {
    if (s.from > next) return false;
    if (s.to >= next) next = plusDays(s.to, 1);
  }
  return next > to;
}

interface Cell {
  target: number | null;
  actual: number;
  pct: number | null;
}
const pctOf = (actual: number, target: number): number => Math.round((actual / target) * 1000) / 10;
const cell = (actual: number, target: number | null): Cell => ({ target, actual, pct: target === null ? null : pctOf(actual, target) });

@Injectable()
export class TargetMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    private readonly money: MoneyMetricsService,
    private readonly gallons: GallonMetricsService,
    private readonly customers: CustomerMetricsService,
    @Inject(DASHBOARD_TOKENS.AiOrgSources) private readonly sources: AiOrgSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    const c = await openGroup(this.scopes, TARGET_METRICS, 'target', metricId, user, query, now);
    if (c.scope.spans.length === 0) return c.none(NO_SCOPE);
    const spec = SPEC[metricId as TargetMetricId];
    const actual = await this[spec.group].answer(spec.actual, user, query, now);
    // The base metric's own refusal (open month, small group, source down) is this metric's too, word for word.
    if (actual.status !== 'ok') return actual.status === 'ditahan' ? c.held(actual.reason ?? '') : c.none(actual.reason ?? DOWN);

    // ONE grouped read per 100 depots, never one per depot.
    const depotIds = c.scope.echo.depotIds;
    const targets = new Map<string, number>();
    for (let i = 0; i < depotIds.length; i += DEPOTS_PER_READ) {
      const rows = await this.sources.depotTargets(depotIds.slice(i, i + DEPOTS_PER_READ), c.period.from.slice(0, 7));
      if (!rows) return c.none(DOWN);
      for (const r of rows) targets.set(r.depotId, r[spec.field]);
    }
    // A depot readable for only part of the month has an actual for those days against a whole-month goal: not comparable.
    const whole = new Set(depotIds.filter((d) => coversWholePeriod(c.scope.spans, d, c.period.from, c.period.to)));
    const comparable = (depotId: string): boolean => whole.has(depotId) && (targets.get(depotId) ?? 0) > 0;
    const set = depotIds.filter(comparable);
    if (set.length === 0) return c.none('Belum ada target bulan ini untuk depot yang boleh Anda baca; tidak dibandingkan dengan 0.');

    const split = c.split ? (actual.value as { total: number; byDepot: { depotId: string; value: number }[] }) : null;
    const everyDepot = set.length === depotIds.length;
    const sumTarget = depotIds.reduce((n, d) => n + (targets.get(d) ?? 0), 0);
    const label =
      `target ${spec.what} satu bulan penuh, dijumlahkan dari target depot; pct = aktual dibagi target dikali 100 (satu desimal). ` +
      'Target 0 atau belum diisi berarti belum ada target (null), bukan target 0. Bulan yang masih berjalan: aktual sampai hari ini, bukan proyeksi. ' +
      'Target jaringan hanya diisi bila setiap depot dalam cakupan punya target dan boleh dibaca penuh bulan ini';
    if (!split) {
      if (!everyDepot) {
        return c.none(
          `${depotIds.length - set.length} dari ${depotIds.length} depot belum punya target bulan ini atau hanya sebagian bulan boleh Anda baca; angka jaringan tidak dibandingkan dengan target yang tidak lengkap.`,
        );
      }
      return c.ok(cell(actual.value as number, sumTarget), label);
    }
    return c.ok(
      {
        ...cell(split.total, everyDepot ? sumTarget : null),
        byDepot: split.byDepot.map((r) => ({ depotId: r.depotId, ...cell(r.value, comparable(r.depotId) ? (targets.get(r.depotId) as number) : null) })),
      },
      label,
    );
  }
}
