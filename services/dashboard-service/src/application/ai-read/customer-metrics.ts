import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, addLocalDays, dayStartUtc } from '@hydromart/platform';

import { AiCustomerSourcesPort } from '../ports/ai-customer-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { CumulativeScopeService, heldBackNote } from './cumulative-scope.service';
import { AnswerEnvelope } from './envelope';
import {
  DOWN,
  GroupCtx,
  GroupMetricMeta,
  NO_SCOPE,
  SMALL_GROUP_REASON,
  TOO_MANY,
  fitsOneRead,
  openGroup,
  peopleCount,
  roundingNote,
  round5,
  shown,
  sourceSpans,
} from './group-context';
import { SMALL_GROUP_FLAG, SMALL_GROUP_MIN, suppressSmallGroups } from './masking';
import { PeriodQuery } from './period';
import { ReadScopeService } from './scope.service';
import { depotsOn, plusDays } from './stretches';

/**
 * HD-6 H3, the customer metrics of the dictionary (section 3.5). Every one of them counts PEOPLE, so:
 *  - no name, phone or address is ever read, only counts;
 *  - a group of 1 or 2 people is held back (`kurang dari 3`), and a published total that would give a
 *    held-back cell away by subtraction holds its smallest neighbour back too (masking.ts);
 *  - except C-08, a metric is answered for ONE whole calendar month only, so two answers never
 *    overlap and a month cannot be subtracted from a week to isolate the few people between them;
 *  - a month that is still running is answered with counts rounded to a multiple of 5 (a day's
 *    difference would otherwise be the few people who ordered that day); only a closed month is exact;
 *  - C-06 is a running total as of a day, so two dates would subtract into the people who moved
 *    between them: its cells and total are always rounded to a multiple of 5.
 */
export const CUSTOMER_METRICS = {
  'C-01': { unit: 'orang', month: true, oneMonth: true },
  'C-02': { unit: 'orang', month: true, oneMonth: true },
  'C-03': { unit: 'akun', month: true, oneMonth: true },
  'C-04': { unit: 'orang', month: true, oneMonth: true },
  'C-05': { unit: 'orang, persen', month: true, oneMonth: true },
  'C-06': { unit: 'orang', month: true, oneMonth: true },
  'C-07': { unit: 'skor', month: true, oneMonth: true },
  'C-08': { unit: 'orang, persen', month: true },
  'C-09': { unit: 'Rp', month: true, oneMonth: true },
  'C-10': { unit: 'bintang', month: true, oneMonth: true },
} as const satisfies Record<string, GroupMetricMeta>;
export type CustomerMetricId = keyof typeof CUSTOMER_METRICS;
export const CUSTOMER_METRIC_IDS = Object.keys(CUSTOMER_METRICS) as CustomerMetricId[];

const SEGMENT_ACTIVE_DAYS = 30;
const SEGMENT_RISK_DAYS = 60;
const pct = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10;

@Injectable()
export class CustomerMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    private readonly cumulative: CumulativeScopeService,
    @Inject(DASHBOARD_TOKENS.AiCustomerSources) private readonly sources: AiCustomerSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    const c = await openGroup(this.scopes, CUSTOMER_METRICS, 'pelanggan', metricId, user, query, now);
    switch (metricId as CustomerMetricId) {
      case 'C-03':
        return c.none('Jumlah akun baru belum bisa dibaca dari sini: auth-service belum punya jalur baca internal untuk hitungan akun, dan akun tidak punya depot untuk dipotong menurut cakupan Anda.');
      case 'C-07':
        return c.held('Skor risiko churn adalah angka per orang (kelompok 1 orang) dan sebuah perkiraan; tidak dijawab per pelanggan. Pakai C-06 untuk hitungan menurut hari sejak pesanan terakhir.');
      case 'C-09':
        return c.held('Nilai seumur hidup adalah angka per pelanggan (kelompok 1 orang); aturan masking menahannya (kurang dari 3).');
      default:
        break;
    }
    if (c.scope.spans.length === 0) return c.none(NO_SCOPE);
    switch (metricId as CustomerMetricId) {
      case 'C-01':
      case 'C-02':
      case 'C-04':
      case 'C-05':
        return this.window(metricId as CustomerMetricId, c);
      case 'C-06':
        return this.segments(c);
      case 'C-08':
        return this.cohorts(c);
      default:
        return this.ratings(c);
    }
  }

  private async window(id: CustomerMetricId, c: GroupCtx): Promise<AnswerEnvelope> {
    const spans = sourceSpans(c.scope, c.period.timeZone);
    if (!fitsOneRead(spans)) return c.none(TOO_MANY);
    const w = await this.sources.customerWindow(spans, c.period.fromAt);
    if (!w) return c.none(DOWN);
    if (id === 'C-01') {
      return peopleCount(
        c,
        w.newCustomers,
        'pelanggan baru: orang (akun pelanggan, bukan pembeli tanpa nama di kasir) yang pesanan pertamanya di seluruh jaringan, selain BATAL dan VOID, jatuh pada bulan ini; dicatat pada depot pesanan pertama itu',
      );
    }
    if (id === 'C-02') {
      const depots = new Set(spans.map((s) => s.depotId));
      if (depots.size !== 1) return c.held('Pelanggan baru depot tidak dijumlahkan antar depot (orang yang sama bisa baru di dua depot); tanyakan untuk satu depot, atau pakai C-01 untuk jaringan.');
      const [depotId] = [...depots];
      const row = w.newAtDepot.find((r) => r.depotId === depotId);
      return peopleCount(c, row?.customers ?? 0, 'pelanggan baru depot: orang yang pesanan pertamanya di depot ini jatuh pada bulan ini, walau sudah pernah membeli di depot lain');
    }
    if (id === 'C-04') {
      return peopleCount(c, w.active, 'pelanggan aktif: pelanggan bernama dengan paling sedikit satu pesanan bukan BATAL/VOID pada bulan ini, dihitung sekali walau memesan di beberapa depot');
    }
    // C-05: buyers of the month who had ordered before it, anywhere in the network.
    if (w.active === 0) return c.none('Tidak ada pembeli bernama pada bulan ini.');
    const m = suppressSmallGroups(
      [
        { key: 'berulang', people: w.repeat },
        { key: 'pertama kali pada bulan ini', people: w.active - w.repeat },
      ],
      w.active,
    );
    if (m.cells.every((cell) => cell.flag)) return c.held(SMALL_GROUP_REASON);
    const clean = m.cells.every((cell) => !cell.flag) && m.total !== null;
    const cells = m.cells.map((cell) => (cell.value === null ? cell : { ...cell, value: shown(c, cell.value) }));
    return c.ok(
      {
        cells,
        total: m.total === null ? null : shown(c, m.total),
        // the rate is worked out from the numbers as published, never from the exact ones
        ratePct: clean ? pct(shown(c, w.repeat), shown(c, w.active)) : null,
      },
      'pelanggan berulang: pembeli bulan ini yang sudah pernah memesan sebelum bulan ini di depot mana pun; tingkat berulang = berulang / semua pembeli bulan ini. Kelompok kurang dari 3 orang ditahan' + roundingNote(c),
    );
  }

  /** C-06: customers by days since their last order, as of the end of the month (or today while it runs). */
  private async segments(c: GroupCtx): Promise<AnswerEnvelope> {
    const asOf = c.period.to < c.today ? c.period.to : c.today;
    const split = await this.cumulative.split(c.user, depotsOn(c.scope, asOf), asOf);
    if (split.readable.length === 0) {
      return split.heldBack.length > 0
        ? c.held(`Semua depot yang boleh Anda baca baru boleh dibaca belum lama ini; riwayat pesanan sebelum itu bukan hak baca Anda${heldBackNote(split.heldBack)}.`)
        : c.none('Tidak ada depot yang boleh Anda baca pada hari terakhir periode ini.');
    }
    if (split.readable.length > 100) return c.none(TOO_MANY);
    const tz = c.period.timeZone;
    const s = await this.sources.segments(split.readable, {
      riskSince: dayStartUtc(plusDays(asOf, -SEGMENT_RISK_DAYS), tz).toISOString(),
      activeSince: dayStartUtc(plusDays(asOf, -SEGMENT_ACTIVE_DAYS), tz).toISOString(),
      until: addLocalDays(dayStartUtc(asOf, tz), 1, tz).toISOString(),
    });
    if (!s) return c.none(DOWN);
    const total = s.active + s.atRisk + s.inactive;
    if (total === 0) return c.none('Belum ada pelanggan bernama yang pernah memesan di depot ini.');
    const m = suppressSmallGroups(
      [
        { key: 'aktif', people: s.active },
        { key: 'berisiko', people: s.atRisk },
        { key: 'tidak aktif', people: s.inactive },
      ],
      total,
    );
    if (m.cells.every((cell) => cell.flag || cell.value === 0) && m.cells.some((cell) => cell.flag)) return c.held(SMALL_GROUP_REASON);
    // Always a multiple of 5: a total as of two dates subtracts into the people who moved between them.
    const cells = m.cells.map((cell) => (cell.value === null ? cell : { ...cell, value: round5(cell.value) }));
    return c.ok(
      {
        asOf,
        cells,
        // every non-empty cell is held or none is, so a total that survives the all-held check above is never null
        total: round5(m.total as number),
        heldBackDepots: split.heldBack.length,
      },
      `pelanggan menurut hari sejak pesanan terakhir (bukan BATAL/VOID) di depot yang boleh Anda baca pada ${asOf}: aktif sampai ${SEGMENT_ACTIVE_DAYS} hari, berisiko ${SEGMENT_ACTIVE_DAYS + 1} sampai ${SEGMENT_RISK_DAYS} hari, tidak aktif lebih dari ${SEGMENT_RISK_DAYS} hari; semua pesanan sampai hari itu dihitung, sepanjang waktu, hanya di depot yang seluruh riwayatnya boleh Anda baca. Semua angka dibulatkan ke kelipatan 5 (total per tanggal bisa dikurangkan antar tanggal); jendela "aktif" ${SEGMENT_ACTIVE_DAYS} hari ini bukan bulan kalender C-04, jadi keduanya tidak boleh dibandingkan pas. Kelompok kurang dari 3 orang ditahan${heldBackNote(split.heldBack)}`,
    );
  }

  /**
   * C-08: retention by cohort. A cohort with ANY cell held back (fewer than 3 people, or 1 or 2 who
   * did not come back) is held back whole: its published cells would give the held one away.
   */
  private async cohorts(c: GroupCtx): Promise<AnswerEnvelope> {
    const spans = sourceSpans(c.scope, c.period.timeZone);
    if (!fitsOneRead(spans)) return c.none(TOO_MANY);
    const cells = await this.sources.cohorts(spans);
    if (!cells) return c.none(DOWN);
    if (cells.length === 0) return c.none('Tidak ada pelanggan baru pada bulan-bulan ini.');
    const byCohort = new Map<string, Map<number, number>>();
    for (const cell of cells) byCohort.set(cell.cohort, (byCohort.get(cell.cohort) ?? new Map()).set(cell.monthIndex, cell.customers));
    const small = (n: number): boolean => n < SMALL_GROUP_MIN;
    const cohorts = [...byCohort.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cohort, months]) => {
        const size = months.get(0) ?? 0;
        const rows = [...months.entries()].filter(([i]) => i > 0).sort((a, b) => a[0] - b[0]);
        // 1 or 2 who did not return are a group too small to name as well (near-total retention shows them).
        const heldRow = small(size) || rows.some(([, n]) => small(n) || (size - n > 0 && small(size - n)));
        if (heldRow) return { cohort, size: null, flag: SMALL_GROUP_FLAG, months: [] };
        return {
          cohort,
          size: shown(c, size),
          months: rows.map(([monthIndex, n]) => ({ monthIndex, customers: shown(c, n), ratePct: pct(shown(c, n), shown(c, size)) })),
        };
      });
    if (cohorts.every((x) => x.size === null)) return c.held(SMALL_GROUP_REASON);
    return c.ok(
      { cohorts },
      'kohort = bulan pesanan pertama seumur hidup (WIB), pelanggan bernama; persen = yang memesan lagi pada bulan ke-n dibagi ukuran kohort. Hanya pesanan di depot dan hari yang boleh Anda baca yang dihitung. Kohort yang salah satu selnya kurang dari 3 orang (atau yang tidak kembali kurang dari 3) ditahan utuh' + roundingNote(c),
    );
  }

  /** C-10: stars of the reviews of the month's orders, weighted by review (the mean of all of them). */
  private async ratings(c: GroupCtx): Promise<AnswerEnvelope> {
    const spans = sourceSpans(c.scope, c.period.timeZone);
    if (!fitsOneRead(spans)) return c.none(TOO_MANY);
    const r = await this.sources.ratings(spans);
    if (!r) return c.none(DOWN);
    if (r.reviews === 0) return c.none('Belum ada ulasan pada pesanan bulan ini.');
    if (r.reviewers < SMALL_GROUP_MIN) return c.held(SMALL_GROUP_REASON);
    return c.ok(
      { averageStars: Math.round((r.ratingSum / r.reviews) * 10) / 10, reviews: shown(c, r.reviews) },
      'rata-rata bintang ulasan atas pesanan yang dibuat bulan ini, dari semua ulasan sama bobotnya; ulasan dari paling sedikit 3 pelanggan berbeda' + roundingNote(c),
    );
  }
}
