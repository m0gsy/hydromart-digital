import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, gridCellCenter, localMonthKey } from '@hydromart/platform';

import { AiProspectSourcesPort, ProspectAggregate, ProspectKind, ProspectLevel, TOO_MANY_CELLS } from '../ports/ai-prospect-sources.port';
import { AiReadSourcesPort } from '../ports/ai-read-sources.port';
import { DashboardSourcesPort } from '../ports/dashboard-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { holdMore, kecamatanOf } from './area-metrics';
import { AnswerEnvelope } from './envelope';
import { DOWN, GroupMetricMeta, MAX_READ_DEPOTS, NO_SCOPE, SMALL_GROUP_REASON, TOO_MANY, openGroup, settledFrom } from './group-context';
import { COMPLEMENT_FLAG, MaskedCell, suppressSmallGroups } from './masking';
import { ReadScope, ReadScopeService, covers, readsNetwork } from './scope.service';

/**
 * AREA-3: the B2B prospect map (businesses a depot could sell gallons to), counted per depot, kecamatan,
 * kelurahan or 1 km cell. Only counts leave: no business name, phone, address, coordinate (a grid cell is
 * published by its id and its centre), prospect id, assignee or visitor.
 *  - B-01 prospek: the stock as of now (retention deletes history, so no past month can be rebuilt);
 *  - B-02 konversi: prospects that became customers in the month (by the day it happened);
 *  - B-03 kunjungan: accepted GPS visits in the month, and how many distinct businesses they were to.
 * B-02 and B-03 are stamped when they happen and cannot be backdated, so a closed month is answered from
 * day 1 of the next month (owner, 27 Nov 2026). One month per call, so two answers never overlap.
 *
 * Scope: a caller sees only the prospects whose OWNER depot is in the depots it may read, so a region cell
 * never mixes in another depot's prospects. Only a caller that reads every depot and every legal entity
 * also gets the opportunity bucket (no owner depot: "di luar area depot"). Masking as the areas read:
 * a cell, and every breakdown inside it, of 1 or 2 is held back with the smallest neighbour so no
 * subtraction gives it away; at kelurahan level the held mass inside each kecamatan is 0 or at least 3.
 * Accepted residual risks as in area-metrics.ts (grid cells do not nest; cross-scope differencing is the
 * scope's job).
 */
export const PROSPECT_METRICS = {
  'B-01': { unit: 'usaha', month: true, oneMonth: true },
  'B-02': { unit: 'usaha', month: true, oneMonth: true },
  'B-03': { unit: 'kunjungan', month: true, oneMonth: true },
} as const satisfies Record<string, GroupMetricMeta>;
export type ProspectMetricId = keyof typeof PROSPECT_METRICS;
export const PROSPECT_METRIC_IDS = Object.keys(PROSPECT_METRICS) as ProspectMetricId[];

export const PROSPECT_LEVELS = ['depot', 'kecamatan', 'kelurahan', 'grid'] as const satisfies readonly ProspectLevel[];
const KIND: Record<ProspectMetricId, ProspectKind> = { 'B-01': 'stock', 'B-02': 'conversions', 'B-03': 'visits' };
/** One budget for the source call of one read. */
export const PROSPECTS_DEADLINE_MS = 30_000;

const UNKNOWN = 'tidak diketahui';
const NO_KELURAHAN = 'Kelurahan tidak diketahui';
const OPPORTUNITY = 'di luar area depot';
export const PROSPECT_OPEN_REASON =
  'angka konversi dan kunjungan hanya dijawab untuk bulan yang sudah ditutup, mulai tanggal 1 bulan berikutnya; angka bulan yang masih berjalan berubah dari hari ke hari dan bisa dikurangkan menjadi satu usaha.';
export const TOO_MANY_CELLS_REASON = 'Terlalu banyak sel untuk dihitung sekaligus dalam satu jawaban; pakai tingkat yang lebih besar (kecamatan atau depot) atau persempit cakupan.';
export const NOT_CURRENT_MONTH = 'B-01 hanya untuk bulan berjalan: angka ini keadaan saat ini';

export interface ProspectAnswerQuery {
  /** `YYYY-MM`, WIB. */
  month: string;
  level?: string;
}

interface Cell {
  id: string | null;
  label: string | null;
  parent?: string;
  lat?: number;
  lng?: number;
  opportunity?: true;
  /** What the masking counts: the cell's total. */
  people: number;
  src: ProspectAggregate;
}

/** The depots a scoped caller may be answered about: a depot counts only when its granted spans cover the whole fact period. */
function readableDepots(scope: ReadScope, id: ProspectMetricId, today: string, month: string, lastDay: number): string[] {
  const days = id === 'B-01' ? [today] : Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return scope.echo.depotIds.filter((d) => days.every((day) => covers(scope, d, day)));
}

/** Codes in order; a cell with no code sorts after the others of its kecamatan, the nameless one last. */
const sortKey = (c: Cell): string => c.id ?? (c.parent ? `${c.parent}~` : '~~');
const byId = (a: Cell, b: Cell): number => (sortKey(a) < sortKey(b) ? -1 : 1);

/** A breakdown as published: each entry through the small-group rule against the cell's own total. */
function breakdown(counts: Record<string, number>, total: number) {
  const m = suppressSmallGroups(
    Object.keys(counts)
      .sort()
      .map((key) => ({ key, people: counts[key] })),
    total,
  );
  // Held entries that the total would give away by subtraction: the whole breakdown is held.
  return m.cells.map((x) => (m.totalFlag ? { key: x.key, count: null, flag: COMPLEMENT_FLAG } : { key: x.key, count: x.value, ...(x.flag ? { flag: x.flag } : {}) }));
}

/** Phone coverage of a published cell: a count of 1 or 2 on either side (with, without) is not given. */
function phones(withPhone: number, total: number) {
  const m = suppressSmallGroups(
    [
      { key: 'with', people: withPhone },
      { key: 'without', people: total - withPhone },
    ],
    total,
  );
  if (m.totalFlag || m.cells.some((x) => x.flag)) return { withPhone: null, withPhonePct: null };
  return { withPhone, withPhonePct: Math.round((withPhone / total) * 1000) / 10 };
}

/** One cell as published: the numbers only for a cell that was not held back. */
function publish(x: Cell, m: MaskedCell) {
  const head = {
    id: x.id,
    label: x.label,
    ...(x.parent ? { kecamatan: x.parent } : {}),
    ...(x.lat !== undefined ? { lat: x.lat, lng: x.lng } : {}),
    ...(x.opportunity ? { opportunity: true } : {}),
  };
  if (m.value === null) return { ...head, total: null, flag: m.flag };
  const s = x.src;
  return {
    ...head,
    total: m.value,
    ...(s.byCategory ? { byCategory: breakdown(s.byCategory, m.value) } : {}),
    ...(s.byStatus ? { byStatus: breakdown(s.byStatus, m.value) } : {}),
    ...(s.byOutcome ? { byOutcome: breakdown(s.byOutcome, m.value) } : {}),
    ...(s.withPhone !== undefined ? phones(s.withPhone, m.value) : {}),
    ...(s.dataAgeDaysMedian !== undefined ? { dataAgeDaysMedian: s.dataAgeDaysMedian } : {}),
    // distinct businesses visited: a count of 1 or 2 is a group too small to name, as everything else
    ...(s.prospectsVisited !== undefined ? { prospectsVisited: s.prospectsVisited > 0 && s.prospectsVisited < 3 ? null : s.prospectsVisited } : {}),
  };
}

@Injectable()
export class ProspectMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiProspectSources) private readonly sources: AiProspectSourcesPort,
    @Inject(DASHBOARD_TOKENS.AiReadSources) private readonly grants: AiReadSourcesPort,
    @Inject(DASHBOARD_TOKENS.Sources) private readonly depots: DashboardSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: ProspectAnswerQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    const level = (query.level ?? 'kecamatan') as ProspectLevel;
    const deadline = Date.now() + PROSPECTS_DEADLINE_MS;
    const c = await openGroup(this.scopes, PROSPECT_METRICS, 'prospek', metricId, user, { period: 'month', date: `${query.month}-01` }, now);
    const id = metricId as ProspectMetricId;
    if (id === 'B-01' && query.month !== localMonthKey(now, c.period.timeZone)) throw new BadRequestException(NOT_CURRENT_MONTH);
    const network = await readsNetwork(this.grants, user);
    // A network reader needs no depot to be allowed: it also reads the prospects no depot owns.
    if (!network && c.scope.spans.length === 0) return c.none(NO_SCOPE);
    // B-02 and B-03: closed from day 1 of the next month (settledFrom is the 8th: the 1st is the same month key).
    if (id !== 'B-01' && c.today < settledFrom(c.period.to).replace(/-08$/, '-01')) return c.held(PROSPECT_OPEN_REASON);
    // Never the echo's depot ids as they stand: a depot that moved legal entity mid-month is readable only from its span's first day.
    const depotIds = network ? null : readableDepots(c.scope, id, c.today, query.month, Number(c.period.to.slice(8)));
    if (depotIds && depotIds.length === 0) return c.none(NO_SCOPE);
    if (depotIds && depotIds.length > MAX_READ_DEPOTS) return c.none(TOO_MANY);
    const rows = await this.sources.prospectAggregates({ kind: KIND[id], level, month: query.month, depotIds, opportunity: network }, deadline);
    if (!rows) return c.none(DOWN);
    if (rows === TOO_MANY_CELLS) return c.none(TOO_MANY_CELLS_REASON);
    const names = level === 'depot' ? new Map((c.scope.network ?? (await this.depots.allDepots('')) ?? []).map((d) => [d.id, d.name])) : new Map<string, string>();
    const list = rows.map((r): Cell => this.cell(r, level, names)).sort(byId);
    const everyone = list.reduce((n, x) => n + x.people, 0);
    const m = suppressSmallGroups(
      list.map((x) => ({ key: x.id ?? UNKNOWN, people: x.people })),
      everyone,
    );
    if (level === 'kelurahan') holdMore(list, m.cells, kecamatanOf);
    holdMore(list, m.cells, () => 'all');
    if (list.length > 0 && m.cells.every((x) => x.flag)) return c.held(SMALL_GROUP_REASON);
    return c.ok(
      { level, cells: list.map((x, i) => publish(x, m.cells[i])), total: m.total },
      `usaha B2B (prospek) per wilayah: ${LABELS[id]}; menurut depot pemilik usaha itu${network ? ', ditambah usaha di luar area semua depot' : ''}. Tanpa nama, telepon, alamat atau titik: sel kecil hanya diberi id dan pusat sel 1 km. Sumber: customer-service, tabel prospek B2B (data terbuka berlisensi dan temuan lapangan). Sel dan rincian kurang dari 3 ditahan beserta tetangga terkecilnya, dan bila yang ditahan kurang dari 3 (atau, di tingkat kelurahan, dalam satu kecamatan) sel terkecil berikutnya ikut ditahan`,
    );
  }

  private cell(r: ProspectAggregate, level: ProspectLevel, names: ReadonlyMap<string, string>): Cell {
    const base = { people: r.total, src: r };
    if (level === 'depot') {
      return r.key === null ? { ...base, id: null, label: OPPORTUNITY, opportunity: true } : { ...base, id: r.key, label: names.get(r.key) ?? null };
    }
    if (level === 'grid') return { ...base, id: r.key, label: null, ...(r.key ? gridCellCenter(r.key) : {}) };
    if (r.key !== null) return { ...base, id: r.key, label: r.name, ...(r.parent ? { parent: r.parent } : {}) };
    return level === 'kelurahan' && r.parent ? { ...base, id: null, label: NO_KELURAHAN, parent: r.parent } : { ...base, id: null, label: UNKNOWN };
  }
}

const LABELS: Record<ProspectMetricId, string> = {
  'B-01': 'keadaan saat ini (jumlah usaha yang belum menjadi pelanggan, bukan riwayat bulan lalu; yang sudah menjadi pelanggan hanya dihitung per bulan di B-02), dengan rincian kategori dan status, berapa yang punya telepon, dan umur data (median, hari)',
  'B-02': 'usaha yang menjadi pelanggan pada bulan itu (menurut tanggal jadi pelanggan), dengan rincian kategori',
  'B-03': 'kunjungan lapangan yang diterima pada bulan itu, berapa usaha berbeda yang dikunjungi, dengan rincian hasil kunjungan',
};
