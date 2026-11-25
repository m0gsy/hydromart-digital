import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { can } from '@hydromart/access';
import { AuthenticatedUser } from '@hydromart/platform';

import { AiOrgSourcesPort } from '../ports/ai-org-sources.port';
import { AiReadSourcesPort } from '../ports/ai-read-sources.port';
import { DashboardSourcesPort } from '../ports/dashboard-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope } from './envelope';
import { SMALL_GROUP_FLAG, SMALL_GROUP_MIN, suppressSmallGroups } from './masking';
import { PeriodQuery, parsePeriod } from './period';
import { DOWN, ReadEnv, isWholeMonthOrYear, makeEnv, pooled, stretchesOf } from './read-env';
import { ReadScope, ReadScopeService } from './scope.service';

/**
 * HD-6 H5, the franchise and legal-entity metrics of the metric dictionary (section 3.9).
 * W-01 and W-02 count calon mitra (people) and are group-masked; W-04 is held until the money-holder
 * decision and the legal opinion (choice 31A).
 */
export const FRANCHISE_METRICS = {
  'W-01': { unit: 'pengajuan' },
  'W-02': { unit: 'pengajuan' },
  'W-03': { unit: 'depot' },
  'W-04': { unit: 'Rp' },
  'W-05': { unit: 'Rp' },
  'W-06': { unit: 'depot' },
} as const satisfies Record<string, { unit: string }>;
export type FranchiseMetricId = keyof typeof FRANCHISE_METRICS;
export const FRANCHISE_METRIC_IDS = Object.keys(FRANCHISE_METRICS) as FranchiseMetricId[];

/** Entity kind -> the depot type the business names it by (HKP = run by the company, waralaba = a partner's). */
const KIND_NAME: Record<string, string> = { OPERATOR: 'HKP', FRANCHISEE: 'WARALABA', FRANCHISOR: 'INDUK' };
const NO_ENTITY = 'TANPA_BADAN_HUKUM';
/** Most depots W-06 lists in one answer; past it the answer is "persempit", never a cut list. */
const MAX_LISTED = 1000;
const STAGES = ['PENDING', 'DOC_VERIFICATION', 'SURVEY', 'APPROVED', 'REJECTED'];

@Injectable()
export class FranchiseMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiOrgSources) private readonly sources: AiOrgSourcesPort,
    @Inject(DASHBOARD_TOKENS.AiReadSources) private readonly grants: AiReadSourcesPort,
    @Inject(DASHBOARD_TOKENS.Sources) private readonly depots: DashboardSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    if (!Object.prototype.hasOwnProperty.call(FRANCHISE_METRICS, metricId)) {
      throw new NotFoundException('Metrik waralaba ini tidak ada di kamus.');
    }
    const id = metricId as FranchiseMetricId;
    const period = parsePeriod(query, now);
    const scope = await this.scopes.resolve(user, period);
    const env = makeEnv(id, FRANCHISE_METRICS[id].unit, period, scope, now);
    switch (id) {
      case 'W-01':
      case 'W-02':
        return this.applications(id, user, env);
      case 'W-04':
        return env.held(
          'Hak mitra ditahan sampai pemegang uang dan pendapat hukumnya diputuskan (pilihan 31A): buku mitra mencatat seluruh total pesanan untuk pemilik, padahal Syarat menyebut pembayaran langsung ke depot.',
        );
      case 'W-05':
        return this.commission(user, env);
      default:
        if (scope.spans.length === 0) return env.none('Tidak ada depot yang boleh Anda baca pada periode ini.');
        return id === 'W-03' ? this.depotTypes(env) : this.entityAtDate(env);
    }
  }

  /** W-01, W-02: applications carry no depot or legal entity, so only a role that reads every entity and holds the queue may count them. */
  private async applications(id: 'W-01' | 'W-02', user: AuthenticatedUser, env: ReadEnv): Promise<AnswerEnvelope> {
    // Differencing: a month's total minus the same month less one day would isolate one calon mitra (and
    // their stage), so only a whole calendar month or year is answered, never a week or a free range.
    if (!isWholeMonthOrYear(env.period.from, env.period.to)) {
      return env.none('Pengajuan calon mitra hanya dijawab per bulan atau tahun penuh, supaya selisih dua jawaban tidak menunjuk satu orang.');
    }
    if (!can('franchiseApplications', user.role)) {
      return env.held('Pengajuan calon mitra hanya untuk peran yang memegang antrean pengajuan waralaba.');
    }
    const grants = await this.grants.aiGrants(user.role);
    if (!grants) return env.none(DOWN);
    if (!grants.all) {
      return env.held('Pengajuan calon mitra tidak milik badan hukum mana pun; hanya peran yang boleh membaca semua badan hukum yang menjawabnya.');
    }
    const summary = await this.sources.applications({ from: env.period.fromAt, to: env.period.toAt });
    if (!summary) return env.none(DOWN);
    const cells = STAGES.map((s) => ({ key: s, people: summary.byStage[s] ?? 0 }));
    // Only a stage the service names counts: a stage this code does not know would be a silent undercount.
    if (Object.keys(summary.byStage).some((s) => !STAGES.includes(s)) || cells.reduce((a, c) => a + c.people, 0) !== summary.total) {
      return env.none(DOWN);
    }
    const NOTE = 'calon mitra yang mengajukan pada periode (tanggal kirim); pengajuan ditolak dihapus berkala, riwayat tahap baru tercatat sejak fitur ini aktif';
    if (id === 'W-01') {
      return summary.total > 0 && summary.total < SMALL_GROUP_MIN
        ? env.held(`Jumlah calon mitra ${SMALL_GROUP_FLAG}; angka kelompok sekecil ini tidak diberikan.`)
        : env.ok(summary.total, NOTE);
    }
    const masked = suppressSmallGroups(cells, summary.total);
    return env.ok(
      {
        total: masked.total,
        ...(masked.totalFlag ? { totalFlag: masked.totalFlag } : {}),
        byStage: masked.cells.map((c) => ({ stage: c.key, value: c.value, ...(c.flag ? { flag: c.flag } : {}) })),
        conversion: { status: 'belum_ada', reason: 'Konversi dan lama per tahap belum bisa dihitung: riwayat tahap baru mulai dicatat sekarang.' },
      },
      `${NOTE}; tahap = tahap sekarang`,
    );
  }

  /**
   * W-05: HQ's commission from the ledger payout-service keeps, by POSTING date over the days each depot
   * was readable: a void is its own reversing row, so it falls in the period it was voided in.
   */
  private async commission(user: AuthenticatedUser, env: ReadEnv): Promise<AnswerEnvelope> {
    if (!can('hqPayoutRead', user.role)) return env.held('Komisi HQ hanya untuk peran yang boleh membaca pembayaran mitra.');
    if (env.scope.spans.length === 0) return env.none('Tidak ada depot yang boleh Anda baca pada periode ini.');
    let total = 0;
    for (const st of stretchesOf(env.scope, env.period)) {
      const rows = await pooled(st.depotIds, (ids) => this.sources.commission(ids, st.range));
      if (!rows) return env.none(DOWN);
      total += rows.reduce((s, r) => s + r.commissionIdr, 0);
    }
    return env.ok(Math.round(total), 'komisi HQ dari penjualan depot mitra: subtotal barang x persen komisi depot saat pesanan selesai, menurut tanggal pencatatan di buku: pembatalan (void) jatuh pada bulan ia dibatalkan, bukan bulan pesanan; refund belum dibalik');
  }

  /** The legal entity of each depot readable on `day`, and its kind. Null: a source is down. */
  private async entitiesOn(scope: ReadScope, day: string): Promise<{ depotId: string; legalEntityId: string | null; kind: string | null; moved: boolean }[] | null> {
    const on = scope.spans.filter((s) => s.from <= day && day <= s.to);
    const ids = [...new Set(on.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))];
    const kinds = ids.length ? await this.sources.entityKinds(ids) : new Map<string, string>();
    if (!kinds) return null;
    const moves = (depotId: string) => scope.spans.filter((s) => s.depotId === depotId).length > 1;
    return on
      .map((s) => ({
        depotId: s.depotId,
        legalEntityId: s.legalEntityId,
        kind: s.legalEntityId ? (kinds.get(s.legalEntityId.toLowerCase()) ?? null) : null,
        moved: moves(s.depotId),
      }))
      .sort((a, b) => a.depotId.localeCompare(b.depotId));
  }

  /** W-03: active depots by type, today only: neither status nor ownership is kept as history. */
  private async depotTypes(env: ReadEnv): Promise<AnswerEnvelope> {
    const { period, today } = env;
    if (today < period.from || today > period.to) {
      return env.none('Jenis dan status aktif depot hanya tersimpan untuk hari ini; riwayat per tanggal belum dicatat.');
    }
    const all = await this.depots.allDepots('');
    const entities = await this.entitiesOn(env.scope, today);
    if (!all || !entities) return env.none(DOWN);
    // A readable depot depot-service does not list at all is a source that is short, not a depot to skip.
    const listed = new Set(all.map((d) => d.id));
    if (entities.some((e) => !listed.has(e.depotId))) return env.none(DOWN);
    const active = new Map(all.filter((d) => d.active).map((d) => [d.id, d.ownershipType]));
    const mine = entities.filter((e) => active.has(e.depotId));
    const byOwnershipType: Record<string, number> = { HKP: 0, WARALABA: 0, LAINNYA: 0 };
    const byEntityKind: Record<string, number> = { HKP: 0, WARALABA: 0, INDUK: 0, [NO_ENTITY]: 0 };
    for (const e of mine) {
      const type = active.get(e.depotId) as string;
      // A value this code has no word for goes to a fixed bucket: the answer never grows new keys.
      byOwnershipType[type === 'HKP' || type === 'WARALABA' ? type : 'LAINNYA'] += 1;
      const kind = e.kind ? (KIND_NAME[e.kind] ?? NO_ENTITY) : NO_ENTITY;
      byEntityKind[kind] += 1;
    }
    return env.ok(
      { depots: mine.length, byOwnershipType, byEntityKind },
      `depot aktif hari ini (${today}) yang boleh Anda baca; byOwnershipType = jenis pada data depot (nilai lain masuk LAINNYA), byEntityKind = jenis badan hukum pemegang depot hari ini (OPERATOR = HKP, FRANCHISEE = WARALABA)`,
    );
  }

  /** W-06: which legal entity held each depot on the last day of the period (the entity points are dated by day). */
  private async entityAtDate(env: ReadEnv): Promise<AnswerEnvelope> {
    const day = env.period.to;
    const rows = await this.entitiesOn(env.scope, day);
    if (!rows) return env.none(DOWN);
    if (rows.length > MAX_LISTED) return env.none('Terlalu banyak depot untuk satu jawaban; persempit cakupan atau periode.');
    if (rows.length === 0) return env.none(`Tidak ada depot yang boleh Anda baca pada ${day}.`);
    return env.ok(
      rows.map((r) => ({
        depotId: r.depotId,
        legalEntityId: r.legalEntityId,
        kind: r.kind,
        changedInPeriod: r.moved,
      })),
      `badan hukum tiap depot pada ${day}: titik dengan tanggal mulai terakhir yang tidak melewati hari itu; null = belum ada badan hukum tercatat; changedInPeriod = depot pindah badan hukum di dalam periode`,
    );
  }
}
