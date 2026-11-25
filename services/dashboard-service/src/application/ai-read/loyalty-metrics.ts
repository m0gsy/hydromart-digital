import { Injectable, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { AnswerEnvelope, belumAda } from './envelope';
import { PeriodQuery, parsePeriod } from './period';
import { ReadScopeService } from './scope.service';

/**
 * HD-6 H4, the loyalty, referral, promo, subscription and campaign group of the dictionary
 * (section 3.8) and the open queues (3.11, A-01). None of these has its network or per-period
 * source yet: loyalty-service, referral-service, promo-service, the subscription engine and
 * crm-service answer per depot, all-time or per campaign, while owner decisions 28-30 ask for a
 * network total, a period, and each person counted once. Until those sources are built the honest
 * answer is belum_ada WITH the reason, never a number from the old, double-counting reads.
 * Every one of them counts people, so when a source arrives it also owes the masking rule
 * (a cell of fewer than 3 people answers "kurang dari 3", see masking.ts).
 */
export const LOYALTY_METRICS = {
  'O-01': { unit: 'poin', reason: 'Poin diberikan per periode belum dihitung di mana pun; loyalty-service hanya menyimpan saldo dan riwayat per akun.' },
  'O-02': { unit: 'poin', reason: 'Poin ditukar menurut depot pengambilan dan tanggal serah belum ada; yang dihitung sekarang memuat penukaran batal dan memakai depot rumah pelanggan (keputusan 28-A belum dibangun).' },
  'O-03': { unit: 'poin', reason: 'Poin kedaluwarsa belum bisa dijawab: penghapusan poin kedaluwarsa mati secara bawaan, jadi tidak ada yang tercatat.' },
  'O-04': { unit: 'poin', reason: 'Poin beredar jaringan (saldo semua pelanggan, masing-masing sekali) belum ada; yang dihitung sekarang per depot dan menghitung pelanggan di dua depot dua kali (keputusan 28-A belum dibangun).' },
  'O-05': { unit: 'orang', reason: 'Anggota per tingkat menurut tangga tingkat depot belum ada; tingkat tersimpan di tiga tempat yang tidak sama (keputusan 28-A belum dibangun).' },
  'O-06': { unit: 'orang, poin, persen', reason: 'Referral per periode (tanggal memenuhi syarat, kedua sisi, setelah pembatalan) belum ada; yang dihitung sekarang sepanjang waktu dan hanya pihak pengajak (keputusan 29-A belum dibangun).' },
  'O-07': { unit: 'Rp, pesanan', reason: 'Biaya promo dari semua jenis potongan (promo, voucher, member, langganan, reseller) per tanggal pesanan belum ada; laporan yang ada hanya promo dan voucher (keputusan 29-A belum dibangun).' },
  'O-08': { unit: 'langganan, orang', reason: 'Langganan per periode dan per depot belum ada; mesin langganan di order-service hanya menjawab ringkasan jaringan saat ini (keputusan 30-A belum dibangun).' },
  'O-09': { unit: 'orang', reason: 'Penerima kampanye per depot belum ada; crm-service menjawab per kampanye dan jaringan.' },
  'A-01': { unit: 'item', reason: 'Antrean terbuka (insiden, sengketa, persetujuan, perawatan terlambat) per depot belum dikumpulkan di satu tempat; hanya antrean persetujuan yang punya hitungan.' },
} as const satisfies Record<string, { unit: string; reason: string }>;
export type LoyaltyMetricId = keyof typeof LOYALTY_METRICS;
export const LOYALTY_METRIC_IDS = Object.keys(LOYALTY_METRICS) as LoyaltyMetricId[];

@Injectable()
export class LoyaltyMetricsService {
  constructor(private readonly scopes: ReadScopeService) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    if (!Object.prototype.hasOwnProperty.call(LOYALTY_METRICS, metricId)) {
      throw new NotFoundException('Metrik loyalti, promo dan langganan ini tidak ada di kamus.');
    }
    const meta = LOYALTY_METRICS[metricId as LoyaltyMetricId];
    // The period and the scope are still resolved: a bad period is a 400 and an unreadable scope a
    // 503 for every metric alike, and the envelope echoes both.
    const period = parsePeriod(query, now);
    const scope = await this.scopes.resolve(user, period);
    return belumAda({ metricId, period, scope: scope.echo, unit: meta.unit, asOf: now }, meta.reason);
  }
}
