import { Inject, Injectable } from '@nestjs/common';

import { can } from '@hydromart/access';
import { AuthenticatedUser } from '@hydromart/platform';

import { InstantRange } from '../ports/ai-money-sources.port';
import { AiVisitSourcesPort, VisitSummaryRow } from '../ports/ai-visit-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope } from './envelope';
import { DOWN, GroupCtx, GroupMetricMeta, NO_SCOPE, openGroup } from './group-context';
import { PeriodQuery, parsePeriod } from './period';
import { ReadScopeService } from './scope.service';
import { splitByDepot } from './split';
import { DEPOTS_PER_READ, depotsOn, stretchesOf } from './stretches';

/**
 * AI-21: supervisor visits (depot-service Visit and VisitItem) as counts per depot. No metric here counts
 * people and none names the visitor, so no small-group masking is needed; the envelope's personal-data guard
 * still runs on every answer.
 *  - V-01 kunjungan: completed visits whose completion falls in the period;
 *  - V-02 hari: days since the last completed visit, as of today, per depot (null = never visited);
 *  - V-03 tindak lanjut: open follow-ups and the overdue part (deadline before today, WIB), as of today;
 *  - V-04 temuan: FINDING lines of completed visits checked in within the period.
 * `now` = a point in time: the answer's period is today whatever period was sent.
 */
export const VISIT_METRICS = {
  'V-01': { unit: 'kunjungan' },
  'V-02': { unit: 'hari', now: true },
  'V-03': { unit: 'tindak lanjut', now: true },
  'V-04': { unit: 'temuan' },
} as const satisfies Record<string, GroupMetricMeta & { now?: boolean }>;
export type VisitMetricId = keyof typeof VISIT_METRICS;
export const VISIT_METRIC_IDS = Object.keys(VISIT_METRICS) as VisitMetricId[];

const NO_DEPOT_NOW = 'Tidak ada depot yang boleh Anda baca hari ini.';
const PER_DEPOT_ONLY = 'V-02 hanya dijawab per depot (split=depot): satu angka untuk seluruh jaringan tidak berarti apa-apa.';

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
const daysBetween = (from: string, to: string): number =>
  // tz-ok: calendar days as UTC midnights.
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const sum = (rows: readonly VisitSummaryRow[], pick: (r: VisitSummaryRow) => number): number => rows.reduce((s, r) => s + pick(r), 0);

@Injectable()
export class VisitMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiVisitSources) private readonly sources: AiVisitSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery & { split?: string }, now: Date = new Date()): Promise<AnswerEnvelope> {
    const meta: { unit: string; now?: boolean } = VISIT_METRICS[metricId as VisitMetricId] ?? { unit: '' };
    // A metric about NOW is answered over today whatever period was sent; a nonsense period is still a 400.
    const asked = meta.now ? { period: 'day', split: query.split } : query;
    if (meta.now && (query.period !== undefined || query.from !== undefined || query.to !== undefined || query.date !== undefined)) {
      parsePeriod(query, now);
    }
    const c = await openGroup(this.scopes, VISIT_METRICS, 'kunjungan', metricId, user, asked, now);
    // aiRead is the door to the API, not to this group: visits are for the roles that may read visits at all.
    if (!can('visitRead', user.role, c.scope.echo.depotIds)) return c.held('Data kunjungan hanya untuk peran yang boleh membaca kunjungan supervisor.');
    if (c.scope.spans.length === 0) return c.none(NO_SCOPE);
    switch (metricId as VisitMetricId) {
      case 'V-01':
        return this.counted(c, (r) => r.completed, 'kunjungan supervisor yang selesai (status SELESAI) menurut hari selesainya, di depot yang boleh Anda baca pada hari itu');
      case 'V-04':
        return this.counted(c, (r) => r.findings, 'baris checklist berhasil TEMUAN pada kunjungan selesai, menurut hari check-in kunjungannya; kunjungan yang belum selesai tidak dihitung');
      case 'V-02':
        return this.daysSince(c);
      default:
        return this.followUps(c);
    }
  }

  /** Reads the readable depots in stretches of up to 100, pooled; null if any read fails. */
  private async pull(depotIds: readonly string[], range: InstantRange): Promise<VisitSummaryRow[] | null> {
    const out: VisitSummaryRow[] = [];
    for (let i = 0; i < depotIds.length; i += DEPOTS_PER_READ) {
      const rows = await this.sources.summary(depotIds.slice(i, i + DEPOTS_PER_READ), range);
      if (!rows) return null;
      out.push(...rows);
    }
    return out;
  }

  /** A count over the period: one total, or total and every depot with `split=depot`. */
  private async counted(c: GroupCtx, pick: (r: VisitSummaryRow) => number, label: string): Promise<AnswerEnvelope> {
    const rows: VisitSummaryRow[] = [];
    for (const st of stretchesOf(c.scope, c.period)) {
      const part = await this.pull(st.depotIds, st.range);
      if (!part) return c.none(DOWN);
      rows.push(...part);
    }
    return c.ok(c.split ? splitByDepot(c.scope.echo.depotIds, rows, pick) : sum(rows, pick), label);
  }

  /** The depots readable today with their counts as of now (the window is irrelevant to these figures). */
  private async nowRows(c: GroupCtx): Promise<VisitSummaryRow[] | 'none' | null> {
    const depotIds = depotsOn(c.scope, c.today);
    return depotIds.length === 0 ? 'none' : this.pull(depotIds, { from: c.period.fromAt, to: c.period.toAt });
  }

  private async daysSince(c: GroupCtx): Promise<AnswerEnvelope> {
    if (!c.split) return c.none(PER_DEPOT_ONLY);
    const rows = await this.nowRows(c);
    if (rows === 'none') return c.none(NO_DEPOT_NOW);
    if (rows === null) return c.none(DOWN);
    return c.ok(
      {
        byDepot: rows
          .map((r) => ({ depotId: r.depotId, days: r.lastCompletedOn === null ? null : Math.max(0, daysBetween(r.lastCompletedOn, c.today)) }))
          .sort((a, b) => a.depotId.localeCompare(b.depotId)),
      },
      'hari sejak kunjungan supervisor terakhir yang selesai (menurut hari selesainya, sepanjang waktu) sampai hari ini; null = depot belum pernah dikunjungi; keadaan saat ini, periode yang ditanyakan tidak mengubahnya',
    );
  }

  private async followUps(c: GroupCtx): Promise<AnswerEnvelope> {
    const rows = await this.nowRows(c);
    if (rows === 'none') return c.none(NO_DEPOT_NOW);
    if (rows === null) return c.none(DOWN);
    const total = { open: sum(rows, (r) => r.followUpsOpen), overdue: sum(rows, (r) => r.followUpsOverdue) };
    return c.ok(
      c.split ? { ...total, byDepot: rows.map((r) => ({ depotId: r.depotId, open: r.followUpsOpen, overdue: r.followUpsOverdue })).sort((a, b) => a.depotId.localeCompare(b.depotId)) } : total,
      'tindak lanjut temuan kunjungan yang masih terbuka sekarang (open, termasuk yang lewat tenggat) dan yang lewat tenggat (overdue: tenggat sebelum hari ini, WIB), dari kunjungan yang sudah selesai; keadaan saat ini, periode yang ditanyakan tidak mengubahnya',
    );
  }
}
