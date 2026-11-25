import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { AiCustomerSourcesPort, DeliverySummary, FAILURE_REASON_CODES } from '../ports/ai-customer-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { CumulativeScopeService, heldBackNote } from './cumulative-scope.service';
import { AnswerEnvelope } from './envelope';
import { DOWN, GroupCtx, GroupMetricMeta, NO_SCOPE, OPEN_MONTH_REASON, TOO_MANY, fitsOneRead, isOpen, openGroup, sourceSpans } from './group-context';
import { COMPLEMENT_FLAG, SMALL_GROUP_FLAG, SMALL_GROUP_MIN, suppressSmallGroups } from './masking';
import { PeriodQuery } from './period';
import { ReadScopeService } from './scope.service';
import { depotsOn } from './stretches';

/**
 * HD-6 H3, delivery and courier metrics (dictionary section 3.6). A courier is one person, and in a
 * depot with one or two couriers the on-time share, the median minutes and the failures ARE that
 * courier's record. So EVERY slice answers only when 3 or more distinct couriers (delivering or
 * failing) are behind it. Nested periods (d1..d7 and d1..d6) would subtract into one courier's day, so K-01 to K-05
 * answer ONLY one whole calendar month, and only a CLOSED one (a running month watched day by day steps by one
 * courier's day). K-06 (a rating per courier) is never answered; K-07 is the live state.
 */
export const DELIVERY_METRICS = {
  'K-01': { unit: 'pengiriman', month: true, oneMonth: true },
  'K-02': { unit: 'persen', month: true, oneMonth: true },
  'K-03': { unit: 'menit', month: true, oneMonth: true },
  'K-04': { unit: 'pengiriman', month: true, oneMonth: true },
  'K-05': { unit: 'kurir, pengiriman', month: true, oneMonth: true },
  'K-06': { unit: 'bintang' },
  'K-07': { unit: 'pesanan' },
} as const satisfies Record<string, GroupMetricMeta>;
export type DeliveryMetricId = keyof typeof DELIVERY_METRICS;
export const DELIVERY_METRIC_IDS = Object.keys(DELIVERY_METRICS) as DeliveryMetricId[];

/** Orders that are placed but not yet confirmed by the depot. */
export const NOT_CONFIRMED_STATUSES = ['CREATED'] as const;
/** Confirmed or being prepared: no courier yet. */
export const UNROUTED_STATUSES = ['CONFIRMED', 'PREPARING'] as const;
/** A courier has the order. */
export const WITH_COURIER_STATUSES = ['DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'] as const;

const COURIERS_REASON = 'Kurang dari 3 kurir yang mengantar atau gagal mengantar pada irisan ini; angka satu atau dua kurir adalah catatan orangnya sendiri, jadi tidak dijawab dengan angkanya (kurang dari 3).';
const pct1 = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10;

/** A count that is a group of customers' orders: 1 or 2 is held back. */
const maskedCount = (n: number): { value: number | null; flag?: string } =>
  n > 0 && n < SMALL_GROUP_MIN ? { value: null, flag: SMALL_GROUP_FLAG } : { value: n };

@Injectable()
export class DeliveryMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    private readonly cumulative: CumulativeScopeService,
    @Inject(DASHBOARD_TOKENS.AiCustomerSources) private readonly sources: AiCustomerSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    // K-07 is the state right now: whatever period was asked, the scope is worked out for today.
    const c = await openGroup(this.scopes, DELIVERY_METRICS, 'pengiriman', metricId, user, metricId === 'K-07' ? { period: 'day' } : query, now);
    if (metricId === 'K-06') {
      return c.held('Rating per kurir adalah penilaian atas satu orang (kelompok 1 orang); tidak dijawab. Rating pelanggan per depot ada di C-10.');
    }
    if (c.scope.spans.length === 0) return c.none(NO_SCOPE);
    if (metricId === 'K-07') return this.live(c);
    if (isOpen(c)) return c.held(OPEN_MONTH_REASON);
    const spans = sourceSpans(c.scope, c.period.timeZone);
    if (!fitsOneRead(spans)) return c.none(TOO_MANY);
    const s = await this.sources.deliverySummary(spans);
    if (!s) return c.none(DOWN);
    // The floor of every slice: one or two couriers behind a number make it their own record.
    if (s.couriers > 0 && s.couriers < SMALL_GROUP_MIN) return c.held(COURIERS_REASON);
    switch (metricId as DeliveryMetricId) {
      case 'K-01':
        return c.ok(s.delivered, 'pengiriman terkirim pada periode menurut waktu terkirim (WIB), depot pengantaran; satu pengiriman per pesanan');
      case 'K-02':
        return s.delivered === 0
          ? c.none('Tidak ada pengiriman selesai pada periode ini, jadi ketepatan tidak bisa dihitung (bukan 0%).')
          : c.ok({ ratePct: pct1(s.onTime, s.delivered), onTime: s.onTime, delivered: s.delivered }, DeliveryMetricsService.onTimeLabel(s));
      case 'K-03':
        return s.medianMinutes === null
          ? c.none('Tidak ada pengiriman selesai pada periode ini.')
          : c.ok(s.medianMinutes, 'median menit dari kurir ditugaskan sampai terkirim; jam dimulai ulang bila pelanggan minta dijadwalkan ulang, tidak bila depot mengganti kurir');
      case 'K-04':
        return this.failed(c, s, spans);
      default:
        return this.team(c, s);
    }
  }

  private static onTimeLabel(s: DeliverySummary): string {
    const rest = s.delivered - s.storedVerdicts;
    return (
      'tepat waktu = status yang disimpan saat pengiriman selesai (ambang pengaturan depot, bila kosong ambang jaringan dari /hq/sla-policy); ' +
      `${s.storedVerdicts} dari ${s.delivered} pengiriman memakai status tersimpan` +
      (rest > 0
        ? `, ${rest} yang selesai sebelum status disimpan dihitung ulang dari jam kurir ditugaskan dengan ambang ${s.thresholdMinutes === null ? 'masing-masing depot (berbeda antar depot)' : `${s.thresholdMinutes} menit`}`
        : '')
    );
  }

  /** K-04: failed (with the no-show apart), rescheduled and cancelled-before-departure, each counted apart; a cell of 1 or 2 is held. */
  private async failed(c: GroupCtx, s: DeliverySummary, spans: ReturnType<typeof sourceSpans>): Promise<AnswerEnvelope> {
    const cancelled = await this.sources.cancelledBeforeDeparture(spans);
    if (cancelled === null) return c.none(DOWN);
    // With the breakdown, ONE masking call covers every reason cell and the failed total together.
    // Without it (an older delivery-service) the two legacy cells are masked as before.
    const reasons = s.byReason;
    const m = suppressSmallGroups(
      reasons
        ? FAILURE_REASON_CODES.map((k) => ({ key: k, people: reasons[k] }))
        : [
            { key: 'noShow', people: s.noShow },
            { key: 'otherReason', people: s.otherFailed },
          ],
      s.failed,
    );
    const cell = (key: string): number | null => m.cells.find((x) => x.key === key)?.value ?? null;
    const flag = (key: string): string | undefined => m.cells.find((x) => x.key === key)?.flag;
    const resched = maskedCount(s.rescheduled);
    const cancel = maskedCount(cancelled);
    const held: Record<string, string> = {};
    for (const x of m.cells) if (x.flag) held[x.key] = x.flag;
    let noShow = cell('noShow');
    let otherReason = cell('otherReason');
    if (reasons) {
      // noShow IS the NO_SHOW cell. otherReason (failed minus NO_SHOW) is a sum of cells already masked, so it
      // is shown only when the total and NO_SHOW are both shown; otherwise failed - noShow (or failed - otherReason)
      // would hand back a held figure, so it is held with the complement flag.
      noShow = cell('NO_SHOW');
      if (flag('NO_SHOW')) held.noShow = flag('NO_SHOW') as string;
      otherReason = m.total !== null && noShow !== null ? s.failed - noShow : null;
      if (otherReason === null) held.otherReason = COMPLEMENT_FLAG;
    }
    if (m.totalFlag) held.failed = m.totalFlag;
    if (resched.flag) held.rescheduled = resched.flag;
    if (cancel.flag) held.cancelledBeforeDeparture = cancel.flag;
    return c.ok(
      {
        failed: m.total,
        noShow,
        otherReason,
        byReason: reasons ? Object.fromEntries(FAILURE_REASON_CODES.map((k) => [k, cell(k)])) : null,
        rescheduled: resched.value,
        cancelledBeforeDeparture: cancel.value,
        held,
      },
      'gagal = pengiriman yang berakhir GAGAL menurut tanggal gagal; noShow = pelanggan tidak di tempat; otherReason = semua alasan selain noShow (gagal dikurangi noShow); ' +
        (reasons
          ? 'bila byReason ada, otherReason ditahan bila noShow atau gagal ditahan; byReason = gagal menurut alasan tetap pilihan kurir: ADDRESS_NOT_FOUND Alamat tidak ditemukan, CUSTOMER_REFUSED Pelanggan menolak, GOODS_DAMAGED Barang rusak, CANNOT_CONTACT Pelanggan tidak bisa dihubungi, OTHER Lainnya, NO_SHOW Pelanggan tidak di tempat, DEPOT_CANCELLED Dibatalkan depot; "Lainnya" (OTHER) juga memuat alasan lama berupa teks bebas yang tidak punya kode; semua sel alasan dan gagal ditahan bersama (sel 1 atau 2 ditahan, pelengkapnya ikut ditahan); teks bebas tidak pernah dikirim; '
          : 'byReason = null: rincian alasan belum tersedia dari layanan pengiriman; ') +
        'alasan lain yang diketik kurir tidak diperinci karena teks bebas bisa memuat nama atau nomor orang; rescheduled = kali dijadwalkan ulang menurut tanggal kejadian; cancelledBeforeDeparture = pesanan antar yang dibatalkan sebelum kurir berangkat (belum sampai diambil atau dalam perjalanan), menurut tanggal batal. Ketiganya dihitung terpisah, bukan bagian dari gagal. Hitungan kurang dari 3 ditahan (held)',
    );
  }

  /** K-05: couriers as a group (3 or more by the floor above), whole month. */
  private team(c: GroupCtx, s: DeliverySummary): AnswerEnvelope {
    if (s.couriers === 0) return c.none('Tidak ada pengiriman selesai atau gagal pada bulan ini.');
    if (s.delivered === 0) return c.none('Tidak ada pengiriman selesai pada bulan ini.');
    return c.ok(
      {
        couriers: s.couriers,
        delivered: s.delivered,
        failed: s.failed,
        averageDeliveredPerCourier: Math.round((s.delivered / s.couriers) * 10) / 10,
        onTimeRatePct: pct1(s.onTime, s.delivered),
      },
      'antar bersama semua kurir yang punya pengiriman selesai atau gagal pada bulan ini (identitas kurir tidak dikirim); gagal dan ketepatan untuk seluruh kelompok, bukan per kurir',
    );
  }

  /**
   * K-07: delivery orders in flight right now at the depots readable today, whatever day they were
   * placed, as groups (not per status: a status of 1 or 2 orders is one customer's order). Counter
   * sales are never in flight. A depot whose older orders predate its readable days is held back.
   */
  private async live(c: GroupCtx): Promise<AnswerEnvelope> {
    const split = await this.cumulative.split(c.user, depotsOn(c.scope, c.today), c.today);
    if (split.readable.length === 0) {
      return split.heldBack.length > 0
        ? c.held(`Depot yang boleh Anda baca baru boleh dibaca belum lama ini; pesanan lama mereka bukan hak baca Anda${heldBackNote(split.heldBack)}.`)
        : c.none('Tidak ada depot yang boleh Anda baca hari ini.');
    }
    if (split.readable.length > 100) return c.none(TOO_MANY);
    const rows = await this.sources.liveOrders(split.readable);
    if (!rows) return c.none(DOWN);
    const sum = (statuses: readonly string[]): number => rows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r.count, 0);
    const total = rows.reduce((n, r) => n + r.count, 0);
    // A status the groups do not name would make them add up to less than the total: not a shape we know.
    if (sum([...NOT_CONFIRMED_STATUSES, ...UNROUTED_STATUSES, ...WITH_COURIER_STATUSES]) !== total) return c.none(DOWN);
    const m = suppressSmallGroups(
      [
        { key: 'notConfirmed', people: sum(NOT_CONFIRMED_STATUSES) },
        { key: 'withoutCourier', people: sum(UNROUTED_STATUSES) },
        { key: 'withCourier', people: sum(WITH_COURIER_STATUSES) },
      ],
      total,
    );
    const at = (key: string) => m.cells.find((x) => x.key === key);
    const held = Object.fromEntries(m.cells.flatMap((x) => (x.flag ? [[x.key, x.flag]] : [])));
    if (m.totalFlag) held.total = m.totalFlag;
    return c.ok(
      {
        total: m.total,
        notConfirmed: at('notConfirmed')?.value ?? null,
        withoutCourier: at('withoutCourier')?.value ?? null,
        withCourier: at('withCourier')?.value ?? null,
        held,
        heldBackDepots: split.heldBack.length,
      },
      `pesanan antar yang sedang berjalan sekarang (${c.today}, WIB), berapa pun umurnya, di depot yang seluruh riwayatnya boleh Anda baca; notConfirmed = baru dibuat, belum dikonfirmasi depot; withoutCourier = dikonfirmasi atau disiapkan, belum dapat kurir; withCourier = kurir sudah ditugaskan sampai dalam pengiriman. Penjualan kasir tidak ikut. Periode yang Anda sebut tidak dipakai: ini keadaan hari ini. Angka langsung: selisih antar waktu menunjukkan perubahan pesanan, bukan orang. Hitungan kurang dari 3 ditahan${heldBackNote(split.heldBack)}`,
    );
  }
}
