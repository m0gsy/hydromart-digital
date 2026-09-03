import { Provider } from '@nestjs/common';

import {
  ERASURE_EXECUTORS,
  ERASURE_EXEMPTIONS,
  ErasureExecutor,
  ErasureExemption,
} from '../../application/ports/erasure-executor.port';
import { AuthConfigService } from '../../config/auth-config.service';
import { RemoteErasureExecutor } from './remote-erasure.executor';
import { UnenforcedErasure } from './unenforced-erasure.executor';

/**
 * Every place outside auth-service that holds the person who asked to be forgotten.
 *
 * The list is the contract. A dataset that is not here is reported UNENFORCED by
 * `DataSubjectService`, exactly as `purge-executor.registry.ts` does for retention — the
 * point is that a gap is NAMED rather than invisible. Adding a table that carries a
 * customer's name, phone or address to any service means adding a line here.
 *
 * Row counts are from `docs/AUDIT_L3.md` §4.2, measured on the live cluster 2026-08-25.
 */
const REMOTE_DATASETS = [
  /*
   * customer-service is deliberately NOT here. `CustomerDataPort.anonymise()` has called it
   * since tahap 1 and is fail-closed and tested; listing it again would make one click send
   * two identical requests. What it was MISSING — `reseller_profiles`, read as personal data
   * by `exportFor()` in the same repository whose `anonymise()` never touched it — is fixed
   * inside that existing endpoint, not by a second one.
   */
  /*
   * crm.notifications (3.033 rows) + crm.campaign_recipients (17). Message history, per
   * phone number. Retention already deletes `notifications_messages` after 90 days; that
   * is a window, not an answer to "forget me today".
   */
  {
    dataset: 'crm.messages',
    envKey: 'CRM_SERVICE_URL',
    path: '/api/v1/notifications/internal/pdp-anonymise',
  },
  /*
   * delivery.deliveries.recipientPhone (153) and proofs_of_delivery.recipientName (76).
   * The proof has a 365-day retention window with a live executor, so it disappears
   * SOME DAY — the customer asked for today, and a window is not consent.
   */
  {
    dataset: 'delivery.recipients',
    envKey: 'DELIVERY_SERVICE_URL',
    path: '/api/v1/deliveries/internal/pdp-anonymise',
  },
  /*
   * order.subscriptions.phone/recipientName (21). Not history: a standing instruction
   * that keeps placing orders. Erasure CANCELS the subscription and then scrubs its
   * address snapshot — leaving it active with an anonymised name would keep water going
   * to the same door under a blank name, which is worse than doing nothing.
   *
   * `order.orders` is NOT touched here. See EXEMPTIONS below.
   */
  {
    dataset: 'order.subscriptions',
    envKey: 'ORDER_SERVICE_URL',
    path: '/api/v1/subscriptions/internal/pdp-anonymise',
  },
  /*
   * admin.support_tickets.customerPhone (14) plus the free text in ticket_messages —
   * a complaint queue answered by phoning whoever is on the row.
   */
  {
    dataset: 'admin.support_tickets',
    envKey: 'ADMIN_SERVICE_URL',
    path: '/api/v1/support-tickets/internal/pdp-anonymise',
  },
] as const;

/**
 * Datasets that hold this person and have no executor YET, each with what blocks it.
 *
 * Reported UNENFORCED, which is the whole point: a gap that is named is a gap somebody can
 * close, and a gap that is silent is the one the next audit re-discovers.
 */
const UNENFORCED_DATASETS: { dataset: string; reason: string }[] = [
  {
    dataset: 'depot.order_disputes',
    reason:
      'depot.order_disputes (18 baris, AUDIT_L3 §4.2) memegang customerName + orderRef. ' +
      'Kolom customerId sudah ditambahkan (migrasi 20260901120000) dan sengaja belum dibaca ' +
      'siapa pun di rilis ini — kolom dulu, kode yang membacanya rilis berikutnya. ' +
      'Eksekutornya menyusul begitu kolom itu ada di basis data produksi. Sampai saat itu ' +
      'dataset ini UNENFORCED, bukan dilewatkan diam-diam.',
  },
];

/**
 * Written exemptions. An exemption is a DECISION, and a decision that is not written down
 * is indistinguishable from an oversight — which is exactly how these rows were reported
 * as a Kritis defect by one audit and as deliberate retention by another on the same day.
 */
export const ERASURE_EXEMPTION_LIST: ErasureExemption[] = [
  {
    dataset: 'order.orders',
    reason:
      'Riwayat pesanan, pembayaran dan catatan keuangan: kelas FINANCIAL, retensi 10 tahun ' +
      '(kewajiban perpajakan dan audit). Sudah dinyatakan di `notIncluded` pada payload ' +
      'ekspor dan di halaman /hapus-akun. Keputusan pemilik 2026-09-01: retensinya TETAP. ' +
      'Diukur 2026-08-25: 813 baris memegang phone/recipientName/driverPhone.',
  },
  {
    dataset: 'auth.audit_logs',
    reason:
      'Jejak audit keamanan: siapa masuk, dari mana, kapan. Kelas OPERATIONAL, jendela ' +
      '734 hari dengan eksekutor retensi yang berjalan. Menghapusnya atas permintaan ' +
      'berarti menghapus bukti bahwa penghapusan itu sendiri diminta dan disetujui.',
  },
  {
    dataset: 'auth.consent_records',
    reason:
      'Bukti persetujuan. Ia justru catatan yang membuktikan apa yang pernah disetujui dan ' +
      'kapan ditarik — termasuk penarikan yang menghasilkan permintaan penghapusan ini.',
  },
];

export const erasureExecutorProvider: Provider = {
  provide: ERASURE_EXECUTORS,
  inject: [AuthConfigService],
  useFactory: (config: AuthConfigService): ErasureExecutor[] => [
    ...REMOTE_DATASETS.map(
      (d) =>
        new RemoteErasureExecutor(
          d.dataset,
          config.serviceUrl(d.envKey),
          d.path,
          config.internalServiceKey,
        ),
    ),
    ...UNENFORCED_DATASETS.map((d) => new UnenforcedErasure(d.dataset, d.reason)),
  ],
};

export const erasureExemptionProvider: Provider = {
  provide: ERASURE_EXEMPTIONS,
  useValue: ERASURE_EXEMPTION_LIST,
};
