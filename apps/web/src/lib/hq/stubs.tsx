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

// STUB: per-depot SLA endpoint pending — Milestone D. Network SLA is real
// (dashboard executive `deliverySla`); per-depot SLA has no endpoint yet, so the
// depot performance table + depot detail read a fixed sample rate keyed by depotId.
export const PER_DEPOT_SLA_STUB: Record<string, number> = {};

/** Deterministic sample SLA in [0.82, 0.99] for a depotId (so the table is stable). */
export function stubDepotSla(depotId: string): number {
  const override = PER_DEPOT_SLA_STUB[depotId];
  if (override !== undefined) return override;
  return 0.82 + (hash(depotId) % 18) / 100; // 0.82..0.99
}

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

/** Dev-only visual marker: a small amber chip reading "contoh data". */
export function StubBadge() {
  const { t } = useT();
  return <Chip tone="amber">{t('hq.common.stub')}</Chip>;
}
