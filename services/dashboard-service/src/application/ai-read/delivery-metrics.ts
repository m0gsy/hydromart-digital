import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { AiCustomerSourcesPort, DeliverySummary } from '../ports/ai-customer-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope } from './envelope';
import { DOWN, GroupCtx, GroupMetricMeta, NO_SCOPE, TOO_MANY, fitsOneRead, openGroup, sourceSpans } from './group-context';
import { SMALL_GROUP_MIN } from './masking';
import { PeriodQuery } from './period';
import { ReadScopeService } from './scope.service';
import { depotsOn } from './stretches';

/**
 * HD-6 H3, delivery and courier metrics (dictionary section 3.6). A courier is one person: K-05
 * answers only as a group of at least 3 couriers and K-06 (a rating per courier) is never answered.
 * K-05 is a single whole month, so two answers never overlap.
 */
export const DELIVERY_METRICS = {
  'K-01': { unit: 'pengiriman' },
  'K-02': { unit: 'persen' },
  'K-03': { unit: 'menit' },
  'K-04': { unit: 'pengiriman' },
  'K-05': { unit: 'kurir, pengiriman', month: true, oneMonth: true },
  'K-06': { unit: 'bintang' },
  'K-07': { unit: 'pesanan' },
} as const satisfies Record<string, GroupMetricMeta>;
export type DeliveryMetricId = keyof typeof DELIVERY_METRICS;
export const DELIVERY_METRIC_IDS = Object.keys(DELIVERY_METRICS) as DeliveryMetricId[];

/** Order statuses that have no courier yet (the rest of the in-flight ones have one). */
export const UNROUTED_STATUSES = ['CONFIRMED', 'PREPARING'] as const;

const pct1 = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10;

@Injectable()
export class DeliveryMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiCustomerSources) private readonly sources: AiCustomerSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    const c = await openGroup(this.scopes, DELIVERY_METRICS, 'pengiriman', metricId, user, query, now);
    if (metricId === 'K-06') {
      return c.held('Rating per kurir adalah penilaian atas satu orang (kelompok 1 orang); tidak dijawab. Rating pelanggan per depot ada di C-10.');
    }
    if (c.scope.spans.length === 0) return c.none(NO_SCOPE);
    if (metricId === 'K-07') return this.live(c);
    const spans = sourceSpans(c.scope, c.period.timeZone);
    if (!fitsOneRead(spans)) return c.none(TOO_MANY);
    const s = await this.sources.deliverySummary(spans);
    if (!s) return c.none(DOWN);
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
        return c.ok(
          { failed: s.failed, noShow: s.noShow, otherReason: s.otherFailed, rescheduled: s.rescheduled },
          'gagal = pengiriman yang berakhir GAGAL menurut tanggal gagal; noShow = pelanggan tidak di tempat; otherReason = alasan lain yang diketik kurir, tidak diperinci karena teks bebas bisa memuat nama atau nomor orang; rescheduled dihitung terpisah (kali dijadwalkan ulang menurut tanggal kejadian), bukan bagian dari gagal',
        );
      default:
        return this.team(c, s);
    }
  }

  private static onTimeLabel(s: DeliverySummary): string {
    const rest = s.delivered - s.storedVerdicts;
    return (
      `tepat waktu = status yang disimpan saat pengiriman selesai (ambang depot, bila kosong ambang jaringan); ${s.storedVerdicts} dari ${s.delivered} pengiriman memakai status tersimpan` +
      (rest > 0 ? `, ${rest} yang selesai sebelum status disimpan dihitung ulang dengan ambang jaringan ${s.thresholdMinutes} menit dari jam kurir ditugaskan` : '')
    );
  }

  /** K-05: couriers as a group. Fewer than 3 couriers is one or two people's own record, so it is held back. */
  private team(c: GroupCtx, s: DeliverySummary): AnswerEnvelope {
    if (s.couriers === 0) return c.none('Tidak ada pengiriman selesai pada bulan ini.');
    if (s.couriers < SMALL_GROUP_MIN) return c.held('Kurang dari 3 kurir yang mengantar pada bulan ini; catatan satu atau dua kurir tidak dijawab dengan angkanya.');
    return c.ok(
      {
        couriers: s.couriers,
        delivered: s.delivered,
        failed: s.failed,
        averageDeliveredPerCourier: Math.round((s.delivered / s.couriers) * 10) / 10,
        onTimeRatePct: pct1(s.onTime, s.delivered),
      },
      'antar bersama semua kurir yang punya pengiriman selesai pada bulan ini (identitas kurir tidak dikirim); gagal dan ketepatan untuk seluruh kelompok, bukan per kurir',
    );
  }

  /** K-07: orders in flight right now at the depots readable today, whatever day they were placed. */
  private async live(c: GroupCtx): Promise<AnswerEnvelope> {
    const depotIds = depotsOn(c.scope, c.today);
    if (depotIds.length === 0) return c.none('Tidak ada depot yang boleh Anda baca hari ini.');
    if (depotIds.length > 100) return c.none(TOO_MANY);
    const rows = await this.sources.liveOrders(depotIds);
    if (!rows) return c.none(DOWN);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const total = rows.reduce((n, r) => n + r.count, 0);
    const unrouted = rows.filter((r) => (UNROUTED_STATUSES as readonly string[]).includes(r.status)).reduce((n, r) => n + r.count, 0);
    return c.ok(
      { total, withoutCourier: unrouted, withCourier: total - unrouted, byStatus },
      'pesanan yang sedang berjalan sekarang (dibuat sampai dalam pengiriman, berapa pun umurnya) di depot yang boleh Anda baca hari ini; withoutCourier = dikonfirmasi atau disiapkan yang belum dapat kurir. Periode yang disebut tidak berlaku: ini keadaan saat ini',
    );
  }
}
