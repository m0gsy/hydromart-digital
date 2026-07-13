'use client';

import Link from 'next/link';
import { Buildings, ChartLineUp, ChatCircleText, ClipboardText, Lock, Package, Tag, Ticket, Truck, UsersThree } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canManageDepots, canManagePricing, canViewCampaigns, canViewChurn, canViewDashboard, canViewForecast, canViewVouchers } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { ExecutiveDashboard } from '@/lib/types';

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

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function DashboardBody() {
  const { customer } = useAuth();
  const range = defaultRange();
  const { data, error, loading, reload } = useAsync<ExecutiveDashboard>(() =>
    api.get(endpoints.dashboard.executive(range), true),
  );

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { sales, topCustomers, topDepots, deliverySla, sources } = data;
  const totalRevenue = sales?.buckets.reduce((n, b) => n + b.revenue, 0) ?? 0;
  const totalOrders = sales?.buckets.reduce((n, b) => n + b.orderCount, 0) ?? 0;
  const maxRevenue = Math.max(1, ...(sales?.buckets ?? []).map((b) => b.revenue));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <ChartLineUp size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Operations</h1>
        </div>
        <p className="mt-1 text-sm text-muted">Last 30 days across sales and delivery.</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <Link
            href="/dashboard/orders"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
          >
            <ClipboardText size={18} weight="fill" />
            Manage order queue
          </Link>
          <Link
            href="/dashboard/inventory"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
          >
            <Package size={18} weight="fill" />
            Inventory
          </Link>
          {canViewForecast(customer?.role) && (
            <Link
              href="/dashboard/forecast"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              <ChartLineUp size={18} weight="fill" />
              Demand forecast
            </Link>
          )}
          {canViewCampaigns(customer?.role) && (
            <Link
              href="/dashboard/campaigns"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              <ChatCircleText size={18} weight="fill" />
              Campaigns
            </Link>
          )}
          {canViewVouchers(customer?.role) && (
            <Link
              href="/dashboard/vouchers"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              <Ticket size={18} weight="fill" />
              Voucher
            </Link>
          )}
          {canViewChurn(customer?.role) && (
            <Link
              href="/dashboard/churn"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              <UsersThree size={18} weight="fill" />
              Churn risk
            </Link>
          )}
          {canManageDepots(customer?.role) && (
            <Link
              href="/dashboard/depots"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              <Buildings size={18} weight="fill" />
              Depots
            </Link>
          )}
          {canManagePricing(customer?.role) && (
            <Link
              href="/dashboard/pricing"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              <Tag size={18} weight="fill" />
              Dynamic pricing
            </Link>
          )}
        </div>
      </div>

      {/* Headline stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue" value={`Rp ${totalRevenue.toLocaleString('id-ID')}`} hint={`${totalOrders} orders`} />
        <Stat
          label="SLA on-time"
          value={deliverySla ? `${Math.round(deliverySla.slaRate * 100)}%` : '—'}
          hint={deliverySla ? `${deliverySla.onTime}/${deliverySla.totalDelivered} delivered` : undefined}
        />
        <Stat
          label="Avg delivery"
          value={deliverySla?.avgMinutes != null ? `${Math.round(deliverySla.avgMinutes)} min` : '—'}
          hint={deliverySla ? `threshold ${deliverySla.thresholdMinutes} min` : undefined}
        />
        <Stat
          label="Breached / failed"
          value={deliverySla ? `${deliverySla.breached} / ${deliverySla.failedCount}` : '—'}
        />
      </div>

      {(sources.order === 'unavailable' || sources.delivery === 'unavailable') && (
        <p className="text-sm text-amber-700" role="status">
          Some data could not be loaded
          {sources.order === 'unavailable' && ' (sales)'}
          {sources.delivery === 'unavailable' && ' (delivery)'}. Showing what is available.
        </p>
      )}

      {/* Sales trend */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Sales trend</h2>
        {!sales || sales.buckets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No sales in this window.</p>
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

      <div className="grid gap-6 md:grid-cols-2">
        {/* Top customers */}
        <Card className="flex flex-col p-5">
          <h2 className="mb-3 font-semibold">Top customers</h2>
          {!topCustomers || topCustomers.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No data.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {topCustomers.items.map((c) => (
                <li key={c.customerId} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <span className="block font-mono text-xs">{shortId(c.customerId)}</span>
                    <span className="block text-xs text-muted">{c.orderCount} orders</span>
                  </span>
                  <Money amount={c.revenue} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Top depots */}
        <Card className="flex flex-col p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Truck size={18} weight="fill" className="text-brand-500" />
            Top depots
          </h2>
          {!topDepots || topDepots.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No data.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {topDepots.items.map((d) => (
                <li key={d.depotId} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <span className="block font-mono text-xs">{shortId(d.depotId)}</span>
                    <span className="block text-xs text-muted">{d.orderCount} orders</span>
                  </span>
                  <Money amount={d.revenue} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewDashboard(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        The operations dashboard is available to depot managers and head-office staff.
      </CenterState>
    );
  }
  return <DashboardBody />;
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
