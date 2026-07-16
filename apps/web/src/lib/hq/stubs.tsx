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

// Settlement-by-method ("belum settle per metode") is now REAL: payment-service
// GET /payments/unsettled-by-method (endpoints.payments.unsettledByMethod). The old
// UNSETTLED_BY_METHOD_STUB was removed.

// The HQ payout-release queue is now REAL: payout-service GET /payout/hq/pending +
// POST /payout/hq/release (endpoints.payout.hqQueue / .release). The old
// PAYOUT_RELEASE_QUEUE_STUB was removed. Only the dispute count has no source yet.
export const PAYMENTS_DISPUTE_COUNT_STUB = 3;

// Per-product override counts are now REAL: depot-service GET
// /price-overrides/count-by-product (grouped, defaults to the PENDING queue).

// The depot→HQ price-override approval queue is now REAL: depot-service
// GET /price-overrides + approve/reject (endpoints.priceOverrides.*). The old
// PRICE_OVERRIDE_QUEUE_STUB was removed.

// The HQ refund-approval queue is now REAL: payment-service refunds/queue +
// approve/reject track (endpoints.refunds.*). The old REFUND_QUEUE_STUB was removed.

// Network voucher spend + per-voucher burn are now REAL: promo-service GET
// /vouchers/burn-summary (SUM discountApplied). Only the depot→HQ voucher REQUEST
// workflow has no model, so this pending count stays a labeled stub.
export const PENDING_VOUCHER_REQUESTS_STUB = 2;

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

// Export preview row shape. All three groupings (depot/produk/metode) are now REAL:
// depot = executive topDepots, produk = order-service revenue-by-product, metode =
// payment-service revenue-by-method. Type kept here as the shared row contract.
export interface ExportRow {
  label: string;
  orders: number;
  revenue: number;
}

// Commission scheme % per depot is now REAL: payout-service commission-schemes track
// (endpoints.commission.*). The old stubCommissionPct was removed.

// The segment-BUILDER (21d, hq/forms/segment) now uses a REAL estimate: order-service
// GET /reports/segment-estimate (endpoints.segments.estimate). This stub remains ONLY for
// the 17c campaign builder's preset chips (all/loyalty/atRisk/new), whose preset→condition
// mapping has no endpoint yet — badged there. Remove once 17c is wired to real conditions.
export function stubSegmentEstimate(conditionCount: number): number {
  const base = 12_480;
  return Math.max(120, Math.round(base / Math.pow(1.7, conditionCount)));
}

/* ---------- Milestone C — Daily ops, Analytics & growth, Catalog & pricing ---------- */

// Revenue-by-product (22b) is now REAL: order-service GET /reports/revenue-by-category
// (endpoints.reports.revenueByCategory) — grouped per PRODUCT (no category column).
// Retention cohort (22b) is now REAL: order-service GET /reports/retention-cohort. The
// old CATEGORY_REVENUE_STUB / RETENTION_COHORT_STUB were removed.

// Avg delivery time (14d) is now REAL: dashboard-service network roll-up forwards
// delivery-service avgMinutes per depot. Gallon-outstanding (14d) is now REAL:
// depot-service GET /gallon-outstanding (issued − returned). Only the customer RATING
// has no source (no depot-review model) → stays a badged stub.
/** Sample customer rating (1–5) for a depot, stable per id. */
export function stubDepotRating(depotId: string): number {
  return Math.round((4.2 + (hash(depotId) % 8) / 10) * 10) / 10; // 4.2..4.9
}

// STUB: forecast-service returns no confidence score — Milestone D. Sampled per product.
export function stubForecastConfidence(productId: string): number {
  return 0.7 + (hash(productId) % 28) / 100; // 0.70..0.97
}

// Customer lifetime value (17e) is now REAL: order-service GET /reports/customer/:id
// (endpoints.reports.customer). The old stubCustomerLifetimeValue was removed.

// Subscription network aggregate (18c) is now REAL: order-service
// GET /subscriptions/admin/summary (endpoints.subscriptions.adminSummary). The old
// SUBSCRIPTION_PLANS_STUB was removed.

// Broadcast reach (10d) is now REAL for "all"/"per-depot": order-service
// GET /reports/audience-reach (endpoints.reports.audienceReach) — distinct customers with
// an order. Loyalty/staff have no reach source here and stay badged in the page (no number).
// The old stubBroadcastReach was removed.

/* ---------- Milestone D — System, governance, admin & polish ---------- */
// Every export below has NO backend endpoint yet. Sample row CONTENT is literal
// (matching the existing UNSETTLED/REFUND stubs); chrome/labels still go through t().
// Relative times are stored as minutes-ago numbers so rendering is client-safe (no
// server/client Date mismatch).

// The franchise-application pipeline is now REAL: depot-service franchise-applications
// track (endpoints.franchiseApps.*). The old APPLICATION_QUEUE_STUB was removed.

// The cross-service audit trail is now REAL: auth-service GET /auth/audit (with a
// service-to-service ingest endpoint). See endpoints.audit.*. The old AUDIT_LOG_STUB
// was removed.

// Feature flags (8b) + platform config (8b) are now REAL: admin-service
// endpoints.admin.flags / endpoints.admin.settings. The old FEATURE_FLAGS_STUB /
// PLATFORM_SETTINGS_STUB were removed.

// Aggregate service health (13b) is now REAL: admin-service endpoints.admin.health
// (server-side per-service /health fan-out). The old SERVICE_HEALTH_STUB was removed.

// Data-export logs (13c), API keys (13d) and webhooks (19c) are now REAL: admin-service
// endpoints.admin.exportLogs / endpoints.admin.apiKeys / endpoints.admin.webhooks. The old
// EXPORT_LOG_STUB / API_KEYS_STUB / WEBHOOKS_STUB were removed.

// SLA policy (19d) is now REAL: admin-service endpoints.admin.slaPolicy (GET/PUT threshold +
// healthy/critical bands). The old SLA_DEFAULT_MINUTES / SLA_HEALTHY_BAND / SLA_CRITICAL_BAND
// stubs were removed. (delivery-service still grades with its own threshold — noted in-page.)

// Retention windows (19e) are now REAL: admin-service endpoints.admin.retention (GET list +
// PUT one window). The old RETENTION_STUB was removed. Backup status is REAL but has NO engine
// wired, so it's returned and labeled honestly (endpoints.admin.retention → backup.status).

// STUB: active sessions for the security page (19b) — sessions live in auth-service, which has
// no session-admin endpoint here, so this list stays clearly badged. The SECURITY POLICY
// itself (idle timeout / require-2FA / IP allowlist) is REAL: endpoints.admin.security.
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

// Tax & invoice settings are now REAL: payment-service GET/PUT /tax-settings
// (endpoints.tax.*), shared by the tax page (19f) and the invoice template (24d).
// The TaxSettings type now lives in @/lib/types. Only the invoice line items below
// stay sample data (no single order is being previewed).
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

// Incident timeline (14c), support tickets (15a), and fraud & risk (15b) are now REAL:
// admin-service endpoints.admin.incidents / .tickets / .fraud. Their stubs were removed.

// Scheduled reports (15c) are now REAL: admin-service endpoints.admin.scheduledReports.
// The old SCHEDULED_REPORTS_STUB was removed.

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

// Per-event admin notification prefs (23a) are now REAL: admin-service
// endpoints.admin.notifPrefs (GET/PUT, keyed by the current user). The old NOTIF_EVENTS_STUB /
// NotifEventRow were removed — the profile page loads/saves the real per-event channel matrix.

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
