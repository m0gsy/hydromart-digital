'use client';

import { Chip } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// Single home for every mock value in the HQ console. Keep this file the ONLY
// source of stubbed data so live vs mock is never ambiguous — anything rendered
// from here must also show <StubBadge/>.

/** Deterministic 32-bit hash of a string — keeps sample values stable per id. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Per-depot SLA is now REAL: dashboard-service GET /dashboard/network returns a
// real slaRate per depot (delivery-service sla-by-depot). The old stubDepotSla was
// removed — the overview table, scorecard, compare and depot detail all read the
// live roll-up. See endpoints.hq.rollup.

/* ---------- Milestone B — Finance & pricing governance ---------- */

// STUB: cross-depot settlement aggregate ("belum settle per metode") pending — Milestone D.
export interface UnsettledMethodRow {
  method: string;
  amount: number;
  count: number;
}
export const UNSETTLED_BY_METHOD_STUB: UnsettledMethodRow[] = [
  { method: 'QRIS', amount: 4_820_000, count: 128 },
  { method: 'Transfer bank', amount: 3_150_000, count: 54 },
  { method: 'Virtual account', amount: 2_090_000, count: 37 },
  { method: 'E-wallet', amount: 1_240_000, count: 61 },
  { method: 'Tunai', amount: 980_000, count: 22 },
];

// STUB: HQ payout-release queue + dispute count pending — Milestone D.
export interface PayoutReleaseRow {
  id: string;
  owner: string;
  depot: string;
  amount: number;
}
export const PAYOUT_RELEASE_QUEUE_STUB: PayoutReleaseRow[] = [
  { id: 'po-1', owner: 'Budi Santoso', depot: 'Depot Cempaka Putih', amount: 6_420_000 },
  { id: 'po-2', owner: 'Sari Dewi', depot: 'Depot Kelapa Gading', amount: 4_180_000 },
  { id: 'po-3', owner: 'Andi Wijaya', depot: 'Depot Bekasi Timur', amount: 2_960_000 },
];
export const PAYMENTS_DISPUTE_COUNT_STUB = 3;

// STUB: per-product override counts (network base pricing) pending — Milestone D.
export function stubOverrideCount(productId: string): number {
  return hash(productId) % 6; // 0..5
}

// STUB: depot→HQ price-override approval queue pending — Milestone D.
export interface PriceOverrideProposal {
  id: string;
  productName: string;
  depot: string;
  proposedBy: string;
  currentPrice: number;
  proposedPrice: number;
}
export const PRICE_OVERRIDE_QUEUE_STUB: PriceOverrideProposal[] = [
  {
    id: 'ov-1',
    productName: 'Galon 19L isi ulang',
    depot: 'Depot Kelapa Gading',
    proposedBy: 'Manajer depot',
    currentPrice: 20_000,
    proposedPrice: 18_000,
  },
  {
    id: 'ov-2',
    productName: 'Air 600ml (dus)',
    depot: 'Depot Bekasi Timur',
    proposedBy: 'Manajer depot',
    currentPrice: 48_000,
    proposedPrice: 43_200,
  },
];

// STUB: HQ refund approval queue (> Rp 100rb) pending — Milestone D.
export interface RefundRequestRow {
  id: string;
  orderNumber: string;
  method: string;
  depot: string;
  reason: string;
  amount: number;
  requestedBy: string;
  ageHours: number;
}
export const REFUND_QUEUE_STUB: RefundRequestRow[] = [
  {
    id: 'rf-1',
    orderNumber: 'ORD-0231',
    method: 'QRIS',
    depot: 'Depot Cempaka Putih',
    reason: 'Galon bocor saat diantar',
    amount: 145_000,
    requestedBy: 'Operator depot',
    ageHours: 3,
  },
  {
    id: 'rf-2',
    orderNumber: 'ORD-0248',
    method: 'Transfer bank',
    depot: 'Depot Kelapa Gading',
    reason: 'Pesanan dobel',
    amount: 220_000,
    requestedBy: 'Manajer depot',
    ageHours: 9,
  },
  {
    id: 'rf-3',
    orderNumber: 'ORD-0255',
    method: 'Virtual account',
    depot: 'Depot Bekasi Timur',
    reason: 'Barang tidak sesuai',
    amount: 168_000,
    requestedBy: 'Operator depot',
    ageHours: 26,
  },
];

// STUB: network promo budget + per-voucher burn + pending depot voucher requests — Milestone D.
export const PROMO_BUDGET_STUB = { total: 50_000_000, used: 32_400_000 };
export const PENDING_VOUCHER_REQUESTS_STUB = 2;
export function stubVoucherBudget(voucherId: string): number {
  return 1_000_000 + (hash(voucherId) % 9) * 500_000; // 1jt..5jt
}

// STUB: reconciliation lines with no real source (ongkir/refund/deposit) — Milestone D.
export interface ReconStubLines {
  shippingBilled: number;
  refunds: number;
  gallonDeposit: number;
}
export function stubReconLines(depotId: string): ReconStubLines {
  const h = hash(depotId);
  return {
    shippingBilled: 200_000 + (h % 40) * 10_000,
    refunds: (h % 12) * 15_000,
    gallonDeposit: 300_000 + (h % 25) * 20_000,
  };
}

// STUB: export preview groupings other than depot (produk/metode) — Milestone D.
export interface ExportRow {
  label: string;
  orders: number;
  revenue: number;
}
export const EXPORT_BY_PRODUCT_STUB: ExportRow[] = [
  { label: 'Galon 19L isi ulang', orders: 1_820, revenue: 36_400_000 },
  { label: 'Air 600ml (dus)', orders: 640, revenue: 30_720_000 },
  { label: 'Galon 19L baru + air', orders: 210, revenue: 14_700_000 },
  { label: 'Air 1500ml (dus)', orders: 380, revenue: 13_300_000 },
];
export const EXPORT_BY_METHOD_STUB: ExportRow[] = [
  { label: 'QRIS', orders: 1_640, revenue: 41_000_000 },
  { label: 'Transfer bank', orders: 720, revenue: 28_800_000 },
  { label: 'Virtual account', orders: 430, revenue: 17_200_000 },
  { label: 'E-wallet', orders: 560, revenue: 14_000_000 },
  { label: 'Tunai', orders: 300, revenue: 6_000_000 },
];

// STUB: per-depot commission scheme % (no scheme-config endpoint) — Milestone D.
export function stubCommissionPct(depotId: string): number {
  return 18 + (hash(depotId) % 5); // 18..22
}

// STUB: segment size estimate (no segment endpoint) — Milestone D.
export function stubSegmentEstimate(conditionCount: number): number {
  const base = 12_480;
  return Math.max(120, Math.round(base / Math.pow(1.7, conditionCount)));
}

/* ---------- Milestone C — Daily ops, Analytics & growth, Catalog & pricing ---------- */

// STUB: no revenue-by-category endpoint — Milestone D. Executive dashboard reports
// network revenue but not a category breakdown, so the analytics panel samples it.
export interface CategoryRevenueRow {
  label: string;
  revenue: number;
}
export const CATEGORY_REVENUE_STUB: CategoryRevenueRow[] = [
  { label: 'Galon isi ulang', revenue: 148_200_000 },
  { label: 'Air kemasan (dus)', revenue: 92_600_000 },
  { label: 'Galon + air baru', revenue: 41_800_000 },
  { label: 'Dispenser & aksesoris', revenue: 18_400_000 },
];

// STUB: no retention-cohort endpoint — Milestone D. Rows = signup cohorts, cells =
// month-over-month retention ratio (0..1) for the CohortGrid.
export interface CohortRow {
  label: string;
  cells: number[];
}
export const RETENTION_COHORT_STUB: CohortRow[] = [
  { label: 'Feb', cells: [1, 0.72, 0.61, 0.55, 0.5, 0.47] },
  { label: 'Mar', cells: [1, 0.75, 0.64, 0.58, 0.53] },
  { label: 'Apr', cells: [1, 0.7, 0.6, 0.54] },
  { label: 'Mei', cells: [1, 0.78, 0.66] },
  { label: 'Jun', cells: [1, 0.74] },
  { label: 'Jul', cells: [1] },
];

// STUB: per-depot ops metrics with no HQ endpoint (14d compare + 22c scorecard) — Milestone D.
/** Sample average delivery time (minutes) for a depot, stable per id. */
export function stubDepotAvgDelivery(depotId: string): number {
  return 22 + (hash(depotId) % 20); // 22..41 min
}
/** Sample customer rating (1–5) for a depot, stable per id. */
export function stubDepotRating(depotId: string): number {
  return Math.round((4.2 + (hash(depotId) % 8) / 10) * 10) / 10; // 4.2..4.9
}
/** Sample outstanding empty-gallon count for a depot, stable per id. */
export function stubDepotGallonReturn(depotId: string): number {
  return 40 + (hash(depotId) % 120); // 40..159
}

// STUB: forecast-service returns no confidence score — Milestone D. Sampled per product.
export function stubForecastConfidence(productId: string): number {
  return 0.7 + (hash(productId) % 28) / 100; // 0.70..0.97
}

// STUB: no cross-customer lifetime-value endpoint (Customer 360, 17e) — Milestone D.
export function stubCustomerLifetimeValue(customerId: string): number {
  return 350_000 + (hash(customerId) % 60) * 45_000; // ~350rb..3jt
}

// STUB: subscriptions endpoint is customer-scoped; no network aggregate (18c) — Milestone D.
export interface SubscriptionPlanRow {
  id: string;
  productName: string;
  frequency: string;
  subscribers: number;
  nextRun: string;
}
export const SUBSCRIPTION_PLANS_STUB: SubscriptionPlanRow[] = [
  { id: 'sp-1', productName: 'Galon 19L isi ulang', frequency: 'Mingguan', subscribers: 342, nextRun: 'Sen, 09.00' },
  { id: 'sp-2', productName: 'Galon 19L isi ulang', frequency: '2 mingguan', subscribers: 128, nextRun: 'Rab, 10.00' },
  { id: 'sp-3', productName: 'Air 600ml (dus)', frequency: 'Bulanan', subscribers: 76, nextRun: 'Jum, 08.00' },
];

// STUB: no audience-sizing endpoint for the broadcast composer (10d) — Milestone D.
export function stubBroadcastReach(audience: string): number {
  const base: Record<string, number> = {
    all: 12_480,
    depot: 2_140,
    loyalty: 4_320,
    staff: 86,
  };
  return base[audience] ?? 0;
}

/* ---------- Milestone D — System, governance, admin & polish ---------- */
// Every export below has NO backend endpoint yet. Sample row CONTENT is literal
// (matching the existing UNSETTLED/REFUND stubs); chrome/labels still go through t().
// Relative times are stored as minutes-ago numbers so rendering is client-safe (no
// server/client Date mismatch).

// STUB: franchise-application pipeline — real backend track (no franchise-intake service).
export interface ApplicationRow {
  id: string;
  applicant: string;
  proposedName: string;
  city: string;
  phone: string;
  email: string;
  stage: 'baru' | 'dokumen' | 'survei' | 'kontrak';
  ageDays: number;
  docs: { ktp: boolean; npwp: boolean; location: boolean; deposit: boolean; agreement: boolean };
}
export const APPLICATION_QUEUE_STUB: ApplicationRow[] = [
  {
    id: 'app-1',
    applicant: 'Rudi Hartono',
    proposedName: 'Depot Sumber Jernih',
    city: 'Depok',
    phone: '0812-1111-2222',
    email: 'rudi.h@example.com',
    stage: 'baru',
    ageDays: 6,
    docs: { ktp: true, npwp: false, location: true, deposit: false, agreement: false },
  },
  {
    id: 'app-2',
    applicant: 'Maya Kusuma',
    proposedName: 'Depot Tirta Sari',
    city: 'Tangerang',
    phone: '0813-3333-4444',
    email: 'maya.k@example.com',
    stage: 'dokumen',
    ageDays: 4,
    docs: { ktp: true, npwp: true, location: true, deposit: false, agreement: false },
  },
  {
    id: 'app-3',
    applicant: 'Doni Prasetyo',
    proposedName: 'Depot Air Murni',
    city: 'Bogor',
    phone: '0814-5555-6666',
    email: 'doni.p@example.com',
    stage: 'survei',
    ageDays: 2,
    docs: { ktp: true, npwp: true, location: true, deposit: true, agreement: false },
  },
  {
    id: 'app-4',
    applicant: 'Linda Wijaya',
    proposedName: 'Depot Segar Alami',
    city: 'Bekasi',
    phone: '0815-7777-8888',
    email: 'linda.w@example.com',
    stage: 'kontrak',
    ageDays: 1,
    docs: { ktp: true, npwp: true, location: true, deposit: true, agreement: true },
  },
];

// STUB: cross-service audit trail — real backend track (no aggregate audit endpoint).
export interface AuditRow {
  id: string;
  actor: string;
  role: string;
  target: string;
  action: string;
  agoMin: number;
}
export const AUDIT_LOG_STUB: AuditRow[] = [
  { id: 'a1', actor: 'Sari Dewi', role: 'Head office', target: 'Depot Kelapa Gading', action: 'Menyetujui override harga', agoMin: 8 },
  { id: 'a2', actor: 'Budi Santoso', role: 'Super admin', target: 'Peran & hak akses', action: 'Mengubah capability voucherWrite', agoMin: 42 },
  { id: 'a3', actor: 'Finance', role: 'Finance', target: 'Payout wa-0231', action: 'Merilis payout ke bank', agoMin: 95 },
  { id: 'a4', actor: 'Marketing', role: 'Marketing', target: 'Voucher HEMAT20', action: 'Menerbitkan voucher', agoMin: 180 },
  { id: 'a5', actor: 'Andi Wijaya', role: 'Head office', target: 'Staf 0812xxxx', action: 'Mengundang staf baru', agoMin: 320 },
  { id: 'a6', actor: 'Super admin', role: 'Super admin', target: 'Feature flag payment-va', action: 'Mengaktifkan rollout', agoMin: 1440 },
];

// STUB: feature-flag + platform config — real backend track (no config service).
export type FlagState = 'ROLLOUT' | 'AKTIF' | 'BETA' | 'MATI';
export interface FeatureFlagRow {
  id: string;
  name: string;
  desc: string;
  state: FlagState;
}
export const FEATURE_FLAGS_STUB: FeatureFlagRow[] = [
  { id: 'f1', name: 'Pembayaran Virtual Account', desc: 'VA per-bank di checkout', state: 'ROLLOUT' },
  { id: 'f2', name: 'Langganan galon', desc: 'Isi ulang terjadwal otomatis', state: 'BETA' },
  { id: 'f3', name: 'Rekomendasi AI', desc: 'Saran produk di beranda', state: 'AKTIF' },
  { id: 'f4', name: 'Live tracking kurir', desc: 'Peta posisi kurir real-time', state: 'AKTIF' },
  { id: 'f5', name: 'Pembayaran tunai di tempat', desc: 'COD saat pengantaran', state: 'MATI' },
];
export interface PlatformSettingRow {
  id: string;
  label: string;
  value: string;
}
export const PLATFORM_SETTINGS_STUB: PlatformSettingRow[] = [
  { id: 'tz', label: 'Zona waktu', value: 'Asia/Jakarta (WIB)' },
  { id: 'cur', label: 'Mata uang', value: 'IDR (Rp)' },
  { id: 'radius', label: 'Radius layanan default', value: '5 km' },
];

// STUB: aggregate service health — real backend track (no health-rollup endpoint).
export interface ServiceHealthRow {
  name: string;
  status: 'up' | 'degraded' | 'down';
  uptime: number; // percent, 0..100
  p95: number; // ms
}
export const SERVICE_HEALTH_STUB: ServiceHealthRow[] = [
  { name: 'auth-service', status: 'up', uptime: 99.98, p95: 82 },
  { name: 'order-service', status: 'up', uptime: 99.95, p95: 141 },
  { name: 'payment-service', status: 'degraded', uptime: 99.4, p95: 512 },
  { name: 'depot-service', status: 'up', uptime: 99.99, p95: 74 },
  { name: 'delivery-service', status: 'up', uptime: 99.9, p95: 168 },
  { name: 'loyalty-service', status: 'up', uptime: 99.97, p95: 96 },
  { name: 'crm-service', status: 'up', uptime: 99.92, p95: 120 },
  { name: 'forecast-service', status: 'up', uptime: 99.8, p95: 240 },
  { name: 'vouchers-service', status: 'up', uptime: 99.96, p95: 88 },
];

// STUB: data-export audit — real backend track (no export-log service).
export interface ExportLogRow {
  id: string;
  dataset: string;
  by: string;
  format: string;
  rows: number;
  status: 'selesai' | 'proses' | 'gagal';
  agoMin: number;
}
export const EXPORT_LOG_STUB: ExportLogRow[] = [
  { id: 'e1', dataset: 'Pendapatan per depot', by: 'Finance', format: 'CSV', rows: 128, status: 'selesai', agoMin: 15 },
  { id: 'e2', dataset: 'Pesanan 30 hari', by: 'Head office', format: 'XLSX', rows: 8420, status: 'selesai', agoMin: 90 },
  { id: 'e3', dataset: 'Pelanggan loyalti', by: 'Marketing', format: 'CSV', rows: 4320, status: 'proses', agoMin: 3 },
  { id: 'e4', dataset: 'Rekonsiliasi payout', by: 'Finance', format: 'PDF', rows: 54, status: 'gagal', agoMin: 240 },
];

// STUB: API credentials — real backend track (no key-management service).
export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAgoMin: number;
}
export const API_KEYS_STUB: ApiKeyRow[] = [
  { id: 'k1', name: 'Gateway pembayaran', prefix: 'hm_live_a1b2', scopes: ['payments:read', 'payments:write'], lastUsedAgoMin: 4 },
  { id: 'k2', name: 'Mitra logistik', prefix: 'hm_live_9f8e', scopes: ['deliveries:read'], lastUsedAgoMin: 55 },
  { id: 'k3', name: 'Data warehouse', prefix: 'hm_live_44cd', scopes: ['orders:read', 'depots:read'], lastUsedAgoMin: 720 },
];

// STUB: webhook subscriptions — real backend track (no webhook service).
export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  delivery: number; // percent
}
export const WEBHOOKS_STUB: WebhookRow[] = [
  { id: 'w1', url: 'https://mitra-bayar.example.com/hooks', events: ['payment.settled', 'refund.approved'], delivery: 99.7 },
  { id: 'w2', url: 'https://gudang.example.com/inbound', events: ['order.dispatched', 'delivery.completed'], delivery: 98.2 },
  { id: 'w3', url: 'https://analitik.example.com/events', events: ['order.created'], delivery: 100 },
];

// STUB: SLA policy — local state only (no policy endpoint). Defaults for the editor.
export const SLA_DEFAULT_MINUTES = 90;
export const SLA_HEALTHY_BAND = 95; // % on-time = sehat
export const SLA_CRITICAL_BAND = 85; // % on-time below = kritis

// STUB: retention & backup — real backend track (no retention service).
export interface RetentionRow {
  id: string;
  dataset: string;
  window: string;
  lastBackup: string;
  status: 'ok' | 'warn';
}
export const RETENTION_STUB: RetentionRow[] = [
  { id: 'r1', dataset: 'Pesanan & transaksi', window: '7 tahun (UU PDP)', lastBackup: 'Hari ini 03:00', status: 'ok' },
  { id: 'r2', dataset: 'Log audit', window: '2 tahun', lastBackup: 'Hari ini 03:05', status: 'ok' },
  { id: 'r3', dataset: 'Bukti pengantaran (PoD)', window: '90 hari', lastBackup: 'Kemarin 03:00', status: 'warn' },
  { id: 'r4', dataset: 'Notifikasi & pesan', window: '180 hari', lastBackup: 'Hari ini 03:02', status: 'ok' },
];

// STUB: security & sessions — real backend track (no session-admin endpoint).
export interface SessionRow {
  id: string;
  device: string;
  location: string;
  ip: string;
  current: boolean;
  agoMin: number;
}
export const ACTIVE_SESSIONS_STUB: SessionRow[] = [
  { id: 's1', device: 'Chrome · Windows', location: 'Jakarta, ID', ip: '103.21.x.x', current: true, agoMin: 0 },
  { id: 's2', device: 'Safari · iPhone', location: 'Jakarta, ID', ip: '114.5.x.x', current: false, agoMin: 35 },
  { id: 's3', device: 'Edge · Windows', location: 'Bandung, ID', ip: '180.2.x.x', current: false, agoMin: 1440 },
];

// STUB: tax & invoice settings — local state only (no billing-config endpoint). Shared
// by the tax page (19f) and the invoice template preview (24d).
export interface TaxSettings {
  ppnPercent: number;
  priceIncludesTax: boolean;
  invoiceFormat: string;
  companyName: string;
  npwp: string;
  address: string;
}
export const TAX_SETTINGS_DEFAULT: TaxSettings = {
  ppnPercent: 11,
  priceIncludesTax: true,
  invoiceFormat: 'INV/{YYYY}/{MM}/{NNNN}',
  companyName: 'PT Hydromart Nusantara',
  npwp: '01.234.567.8-901.000',
  address: 'Jl. Sudirman Kav. 21, Jakarta Pusat 10220',
};
export interface InvoiceLine {
  name: string;
  qty: number;
  unitPrice: number;
}
export const INVOICE_SAMPLE_LINES: InvoiceLine[] = [
  { name: 'Galon 19L isi ulang', qty: 4, unitPrice: 20_000 },
  { name: 'Air 600ml (dus)', qty: 2, unitPrice: 48_000 },
  { name: 'Ongkir', qty: 1, unitPrice: 5_000 },
];

// STUB: incident timeline — real backend track (no incident service).
export interface IncidentRow {
  id: string;
  severity: 'kritis' | 'peringatan' | 'info';
  service: string;
  title: string;
  status: 'terbuka' | 'dipantau' | 'selesai';
  agoMin: number;
}
export const INCIDENTS_STUB: IncidentRow[] = [
  { id: 'i1', severity: 'kritis', service: 'payment-service', title: 'Latensi settlement tinggi', status: 'dipantau', agoMin: 25 },
  { id: 'i2', severity: 'peringatan', service: 'forecast-service', title: 'Rebuild model tertunda', status: 'terbuka', agoMin: 120 },
  { id: 'i3', severity: 'info', service: 'crm-service', title: 'Kuota WhatsApp mendekati batas', status: 'terbuka', agoMin: 200 },
  { id: 'i4', severity: 'kritis', service: 'order-service', title: 'Antrean checkout melambat', status: 'selesai', agoMin: 2880 },
];

// STUB: support tickets — real backend track (no support/ticket service).
export interface TicketMessage {
  from: 'customer' | 'agent';
  text: string;
  agoMin: number;
}
export interface TicketRow {
  id: string;
  subject: string;
  customer: string;
  orderNumber: string;
  priority: 'tinggi' | 'sedang' | 'rendah';
  status: 'terbuka' | 'selesai';
  assignee: string | null;
  thread: TicketMessage[];
}
export const TICKETS_STUB: TicketRow[] = [
  {
    id: 't1',
    subject: 'Galon belum sampai',
    customer: 'Ibu Rina',
    orderNumber: 'ORD-0231',
    priority: 'tinggi',
    status: 'terbuka',
    assignee: null,
    thread: [
      { from: 'customer', text: 'Halo, pesanan saya sudah 2 jam belum datang.', agoMin: 45 },
      { from: 'agent', text: 'Baik Bu, kami cek posisi kurir ya.', agoMin: 30 },
    ],
  },
  {
    id: 't2',
    subject: 'Refund belum masuk',
    customer: 'Pak Joko',
    orderNumber: 'ORD-0248',
    priority: 'sedang',
    status: 'terbuka',
    assignee: 'Agent Nadia',
    thread: [{ from: 'customer', text: 'Refund pesanan dobel belum saya terima.', agoMin: 180 }],
  },
  {
    id: 't3',
    subject: 'Salah alamat',
    customer: 'Ibu Sinta',
    orderNumber: 'ORD-0255',
    priority: 'rendah',
    status: 'selesai',
    assignee: 'Agent Bima',
    thread: [{ from: 'customer', text: 'Alamat saya keliru, sudah dibetulkan. Terima kasih.', agoMin: 1440 }],
  },
];

// STUB: fraud & risk signals — real backend track (no risk-scoring service).
export interface FraudRow {
  id: string;
  subject: string;
  type: 'pesanan' | 'akun';
  score: number; // 0..100
  signals: string[];
}
export const FRAUD_QUEUE_STUB: FraudRow[] = [
  { id: 'fr1', subject: 'ORD-0261', type: 'pesanan', score: 88, signals: ['Nilai jauh di atas rata-rata', 'Alamat baru', '3 voucher dalam 1 pesanan'] },
  { id: 'fr2', subject: '0812-9090-1212', type: 'akun', score: 72, signals: ['5 akun dari 1 perangkat', 'Referral berulang'] },
  { id: 'fr3', subject: 'ORD-0272', type: 'pesanan', score: 54, signals: ['Pembatalan beruntun', 'Metode COD'] },
];

// STUB: scheduled recurring exports — real backend track (no scheduler service).
export interface ScheduledReportRow {
  id: string;
  name: string;
  cadence: string;
  recipients: string;
  nextRun: string;
  on: boolean;
}
export const SCHEDULED_REPORTS_STUB: ScheduledReportRow[] = [
  { id: 'sr1', name: 'Ringkasan pendapatan harian', cadence: 'Harian · 06:00', recipients: 'finance@hydromart.id', nextRun: 'Besok 06:00', on: true },
  { id: 'sr2', name: 'Performa depot mingguan', cadence: 'Senin · 08:00', recipients: 'ho@hydromart.id', nextRun: 'Sen 08:00', on: true },
  { id: 'sr3', name: 'Rekap voucher bulanan', cadence: 'Tgl 1 · 09:00', recipients: 'marketing@hydromart.id', nextRun: '1 Agu 09:00', on: false },
];

// STUB: depot go-live checklist — real backend track (no onboarding-workflow service).
// The "provision depot" step links to the REAL onboard form (/hq/depots?onboard=1).
export interface OnboardStepRow {
  id: string;
  label: string;
  owner: string;
  done: boolean;
  href?: string;
}
export const ONBOARDING_STEPS_STUB: OnboardStepRow[] = [
  { id: 'o1', label: 'Verifikasi dokumen legal', owner: 'Legal', done: true },
  { id: 'o2', label: 'Survei lokasi & radius layanan', owner: 'Ops', done: true },
  { id: 'o3', label: 'Provision depot di sistem', owner: 'Head office', done: false, href: '/hq/depots?onboard=1' },
  { id: 'o4', label: 'Isi stok awal & harga', owner: 'Manajer depot', done: false, href: '/hq/catalog' },
  { id: 'o5', label: 'Onboarding staf & kurir', owner: 'Head office', done: false, href: '/hq/staff' },
  { id: 'o6', label: 'Aktifkan kanal pembayaran', owner: 'Finance', done: false, href: '/hq/payments' },
];

// STUB: per-event notification channel prefs for the admin profile (23a). Account-level
// prefs are real (endpoints.preferences.notifications); the per-EVENT matrix has no
// endpoint — real backend track.
export interface NotifEventRow {
  id: string;
  label: string;
  push: boolean;
  email: boolean;
  wa: boolean;
}
export const NOTIF_EVENTS_STUB: NotifEventRow[] = [
  { id: 'n1', label: 'Lamaran waralaba baru', push: true, email: true, wa: false },
  { id: 'n2', label: 'Refund menunggu persetujuan', push: true, email: true, wa: true },
  { id: 'n3', label: 'Insiden sistem (kritis)', push: true, email: true, wa: true },
  { id: 'n4', label: 'SLA depot di bawah ambang', push: true, email: false, wa: false },
  { id: 'n5', label: 'Laporan terjadwal selesai', push: false, email: true, wa: false },
];

/** Format a minutes-ago number into a localized relative-time label (client-safe). */
export function agoLabel(min: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (min < 1) return t('hq.common.time.now');
  if (min < 60) return t('hq.common.time.min', { n: min });
  if (min < 1440) return t('hq.common.time.hour', { n: Math.round(min / 60) });
  return t('hq.common.time.day', { n: Math.round(min / 1440) });
}

/** Dev-only visual marker: a small amber chip reading "contoh data". */
export function StubBadge() {
  const { t } = useT();
  return <Chip tone="amber">{t('hq.common.stub')}</Chip>;
}
