'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Buildings, CaretRight, ChartLineUp, Gavel, Lock, Package, Truck, UsersThree, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { OperatorRingkasan } from '@/components/operator/operator-ringkasan';
import { Card, CenterState, ErrorState, Money, Skeleton, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { dashboardLandingView } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Approval, Delivery, ExecutiveDashboard, InventoryItem, Page } from '@/lib/types';

// Default window: the trailing 30 days. Computed once per mount (client-only).
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  );
}

// Approval queue for the scoped depot (falls back to the first depot when "All").
function ApprovalsWidget() {
  const { t } = useT();
  const { scopedId } = useDepot();
  const { data, loading } = useAsync<Approval[]>(
    () => (scopedId ? api.get(endpoints.approvals.list({ depotId: scopedId, status: 'PENDING' }), true) : Promise.resolve([])),
    [scopedId],
  );
  const items = data ?? [];
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Gavel size={18} weight="fill" className="text-brand-500" />
          {t('dashboard.landing.approvals.title')}
        </h2>
        {items.length > 0 && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
            {t('dashboard.landing.approvals.waiting', { n: items.length })}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('dashboard.landing.approvals.empty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-[color:var(--border)]">
            {items.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link href={`/dashboard/approvals/${a.id}`} className="flex items-center justify-between gap-2 py-2.5 text-sm hover:opacity-80">
                  <span className="truncate">{a.title}</span>
                  <Money amount={Math.abs(a.amountIdr)} className="shrink-0 font-medium text-[color:var(--danger)]" />
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/approvals" className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            {t('dashboard.landing.approvals.viewAll')} <CaretRight size={13} weight="bold" />
          </Link>
        </>
      )}
    </Card>
  );
}

// Low-stock lines for the scoped depot.
function LowStockWidget() {
  const { t } = useT();
  const { scopedId } = useDepot();
  const { data, loading } = useAsync<InventoryItem[]>(
    () => (scopedId ? api.get(endpoints.inventory.lines(scopedId, { lowStockOnly: true }), true) : Promise.resolve([])),
    [scopedId],
  );
  const items = data ?? [];
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Package size={18} weight="fill" className="text-brand-500" />
          {t('dashboard.landing.lowStock.title')}
        </h2>
        {items.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">{items.length}</span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('dashboard.landing.lowStock.empty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-[color:var(--border)]">
            {items.slice(0, 5).map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span className="truncate">{it.label}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-amber-700">
                  <Warning size={13} weight="fill" />
                  {t('dashboard.landing.lowStock.belowMin', { qty: it.available, unit: it.unit, min: it.minimumStock })}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/inventory" className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            {t('dashboard.landing.lowStock.viewAll')} <CaretRight size={13} weight="bold" />
          </Link>
        </>
      )}
    </Card>
  );
}

// Couriers currently on delivery (network-wide).
function ActiveCouriersWidget() {
  const { t } = useT();
  const { data, loading } = useAsync<Page<Delivery>>(
    () => api.get(endpoints.deliveries.list({ status: 'ON_DELIVERY', limit: 50 }), true),
    [],
  );
  const items = data?.items ?? [];
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Truck size={18} weight="fill" className="text-brand-500" />
          {t('dashboard.landing.couriers.title')}
        </h2>
        {items.length > 0 && (
          <span className="text-xs text-muted">{t('dashboard.landing.couriers.subtitle', { n: items.length })}</span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('dashboard.landing.couriers.empty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-[color:var(--border)]">
            {items.slice(0, 5).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span className="font-mono text-xs">{d.orderNumber}</span>
                <span className="truncate text-right text-xs text-muted">{d.destinationAddress}</span>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/tracking" className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            {t('dashboard.landing.couriers.viewAll')} <CaretRight size={13} weight="bold" />
          </Link>
        </>
      )}
    </Card>
  );
}

// Executive top lists. Both come from the dashboard payload already fetched by
// DashboardBody — no extra request. Customer ids are shown as-is: there is no
// customer-profile batch source on this surface, so inventing names would lie.
function TopListsWidgets({ data }: { data: ExecutiveDashboard }) {
  const { t } = useT();
  const { depots } = useDepot();
  const depotName = (id: string) => depots.find((d) => d.id === id)?.name ?? id;
  const customers = data.topCustomers?.items ?? [];
  const topDepots = data.topDepots?.items ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="flex flex-col p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <UsersThree size={18} weight="fill" className="text-brand-500" />
          {t('dashboard.landing.topCustomers.title')}
        </h2>
        {customers.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('dashboard.landing.topCustomers.empty')}</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {customers.slice(0, 5).map((c) => (
              <li key={c.customerId} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span className="truncate">
                  <span className="font-mono text-xs">{c.customerId.slice(0, 8)}</span>
                  <span className="ml-2 text-xs text-muted">{t('dashboard.landing.orders', { n: c.orderCount })}</span>
                </span>
                <Money amount={c.revenue} className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Buildings size={18} weight="fill" className="text-brand-500" />
          {t('dashboard.landing.topDepots.title')}
        </h2>
        {topDepots.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('dashboard.landing.topDepots.empty')}</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {topDepots.slice(0, 5).map((d) => (
              <li key={d.depotId} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span className="truncate">
                  {depotName(d.depotId)}
                  <span className="ml-2 text-xs text-muted">{t('dashboard.landing.orders', { n: d.orderCount })}</span>
                </span>
                <Money amount={d.revenue} className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DashboardBody({ view }: { view: 'manager' | 'executive' }) {
  const { t } = useT();
  // Manager gets an ops-first KPI set (spec 1a: Order · Pendapatan · Galon · SLA); the other
  // dashboard-capable roles (HEAD_OFFICE/SUPER_ADMIN) keep the exec latency view.
  const isManager = view === 'manager';
  const range = defaultRange();
  const { data, error, loading, reload } = useAsync<ExecutiveDashboard>(() =>
    api.get(endpoints.dashboard.executive(range), true),
  );

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { sales, deliverySla, sources } = data;
  const totalRevenue = sales?.buckets.reduce((n, b) => n + b.revenue, 0) ?? 0;
  const totalOrders = sales?.buckets.reduce((n, b) => n + b.orderCount, 0) ?? 0;
  const maxRevenue = Math.max(1, ...(sales?.buckets ?? []).map((b) => b.revenue));

  const partialWhich =
    (sources.order === 'unavailable' ? t('dashboard.landing.partialSales') : '') +
    (sources.delivery === 'unavailable' ? t('dashboard.landing.partialDelivery') : '');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <ChartLineUp size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('dashboard.landing.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('dashboard.landing.subtitle')}</p>
      </div>

      {/* Headline stats — manager gets the ops KPI set (spec 1a), others the exec set. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isManager ? (
          <>
            <Stat
              label={t('mgrFix.dash.orderToday')}
              value={totalOrders.toLocaleString('id-ID')}
              hint={t('mgrFix.dash.ordersHint', { n: totalOrders })}
            />
            <Stat
              label={t('mgrFix.dash.revenue')}
              value={`Rp ${totalRevenue.toLocaleString('id-ID')}`}
            />
            <Stat
              label={t('mgrFix.dash.gallonsDelivered')}
              value={deliverySla ? deliverySla.totalDelivered.toLocaleString('id-ID') : '—'}
              hint={deliverySla ? t('mgrFix.dash.deliveredHint', { n: deliverySla.totalDelivered }) : undefined}
            />
            <Stat
              label={t('mgrFix.dash.slaOnTime')}
              value={deliverySla ? `${Math.round(deliverySla.slaRate * 100)}%` : '—'}
              hint={deliverySla ? t('mgrFix.dash.slaTarget', { n: 96 }) : undefined}
            />
          </>
        ) : (
          <>
            <Stat
              label={t('dashboard.landing.revenue')}
              value={`Rp ${totalRevenue.toLocaleString('id-ID')}`}
              hint={t('dashboard.landing.orders', { n: totalOrders })}
            />
            <Stat
              label={t('dashboard.landing.slaOnTime')}
              value={deliverySla ? `${Math.round(deliverySla.slaRate * 100)}%` : '—'}
              hint={deliverySla ? t('dashboard.landing.delivered', { onTime: deliverySla.onTime, total: deliverySla.totalDelivered }) : undefined}
            />
            <Stat
              label={t('dashboard.landing.avgDelivery')}
              value={deliverySla?.avgMinutes != null ? t('dashboard.landing.min', { n: Math.round(deliverySla.avgMinutes) }) : '—'}
              hint={deliverySla ? t('dashboard.landing.threshold', { n: deliverySla.thresholdMinutes }) : undefined}
            />
            <Stat
              label={t('dashboard.landing.breachedFailed')}
              value={deliverySla ? `${deliverySla.breached} / ${deliverySla.failedCount}` : '—'}
            />
          </>
        )}
      </div>

      {(sources.order === 'unavailable' || sources.delivery === 'unavailable') && (
        <p className="text-sm text-amber-700" role="status">
          {t('dashboard.landing.partial', { which: partialWhich })}
        </p>
      )}

      {/* Sales trend */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">{t('dashboard.landing.salesTrend')}</h2>
        {!sales || sales.buckets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('dashboard.landing.noSales')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sales.buckets.map((b) => (
              <li key={b.period} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted">{b.period}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                  <span
                    className="block h-full rounded-full bg-brand-600"
                    style={{ width: `${Math.round((b.revenue / maxRevenue) * 100)}%` }}
                  />
                </span>
                <Money amount={b.revenue} className="w-28 shrink-0 text-right font-medium" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Manager: action widgets (approval queue · low stock · active couriers, spec 1a).
          Executive: network top lists — those action queues belong to a depot, not HQ. */}
      {isManager ? (
        <>
          <p className="text-[12.5px] text-muted">{t('dashboard.landing.pickDepotHint')}</p>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <ApprovalsWidget />
            <LowStockWidget />
            <ActiveCouriersWidget />
          </div>
        </>
      ) : (
        <TopListsWidgets data={data} />
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  const router = useRouter();

  // Role-aware landing: franchise owners get their own overview, not the exec one.
  const view = dashboardLandingView(customer?.role);
  const toFranchise = view === 'franchise';
  useEffect(() => {
    if (toFranchise) router.replace('/dashboard/franchise');
  }, [toFranchise, router]);

  if (toFranchise) {
    return (
      <div className="flex justify-center py-24 text-brand-500">
        <Spinner size={28} />
      </div>
    );
  }
  // Depot operators land on their own action-oriented daily summary (design 1a),
  // not the executive dashboard (which they can't view).
  if (view === 'operator') return <OperatorRingkasan />;
  if (view === 'denied') {
    return (
      <CenterState title={t('dashboard.landing.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashboard.landing.gateBody')}
      </CenterState>
    );
  }
  return <DashboardBody view={view} />;
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
