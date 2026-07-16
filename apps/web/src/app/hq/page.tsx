'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ChartLineUp, Warning } from '@phosphor-icons/react';

import { DepotMap } from '@/components/dashboard/depot-map';
import { BarTrend, RankBar, Sparkline } from '@/components/hq/charts';
import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  DepotAdmin,
  ExecutiveDashboard,
  FranchiseApplication,
  NetworkDashboard,
  Page,
} from '@/lib/types';

// Trailing-30-day window, computed once per mount (client-only). Copied from
// franchise/page.tsx so the exec endpoint gets a stable range.
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

type View = 'main' | 'map' | 'compact';

function Stat({ label, value, hint, badge }: { label: string; value: string; hint?: string; badge?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        {label}
        {badge}
      </p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export default function HqOverviewPage() {
  const { t } = useT();
  const router = useRouter();
  const range = useMemo(defaultRange, []);
  const [view, setView] = useState<View>('main');

  const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.hq.overview(range), true));
  const rollup = useAsync<NetworkDashboard>(() => api.get(endpoints.hq.rollup(range), true));
  const depotList = useAsync<Page<DepotAdmin>>(() =>
    api.get(endpoints.depots.manage({ limit: 100 }), true),
  );
  // Two KPI tiles fed by their own endpoints (not on the exec dashboard):
  // new customer signups in-range, and the pending franchise-application queue.
  const newCustomers = useAsync<{ count: number }>(() =>
    api.get(endpoints.hq.newCustomers(range), true),
  );
  const pendingApps = useAsync<Page<FranchiseApplication>>(() =>
    api.get(endpoints.franchiseApps.list({ limit: 100 }), true),
  );

  const depots = depotList.data?.items ?? [];

  if (dash.loading || rollup.loading || depotList.loading) return <Skeleton className="h-96 w-full" />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return null;

  const { sales, deliverySla, sources } = dash.data;
  const buckets = sales?.buckets ?? [];
  const totalRevenue = buckets.reduce((n, b) => n + b.revenue, 0);
  const totalOrders = buckets.reduce((n, b) => n + b.orderCount, 0);
  const activeDepots = depots.filter((d) => d.active).length;
  const slaPct = deliverySla ? Math.round(deliverySla.slaRate * 100) : null;
  // Pending franchise applications = non-terminal stages (mirrors /hq/applications).
  const pendingCount = pendingApps.data
    ? pendingApps.data.items.filter((a) => a.stage !== 'APPROVED' && a.stage !== 'REJECTED').length
    : null;

  const unavailable = Object.entries(sources)
    .filter(([, v]) => v === 'unavailable')
    .map(([k]) => k);

  // Per-depot rows from the real network roll-up (revenue/orders + real SLA).
  const rows = (rollup.data?.depots ?? []).map((d) => ({
    depotId: d.depotId,
    name: d.name,
    revenue: d.revenue,
    orderCount: d.orderCount,
    sla: d.slaRate, // number | null (null = no delivered orders in range)
  }));
  const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);

  // "Needs attention": depots with a real SLA below the healthy band + any down source.
  const lowSla = rows
    .filter((r): r is typeof r & { sla: number } => r.sla != null && r.sla < 0.88)
    .sort((a, b) => a.sla - b.sla);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ChartLineUp size={24} weight="fill" className="text-brand-500" />
            <h1 className="text-2xl font-bold">{t('hq.overview.title')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted">{t('hq.overview.subtitle')}</p>
        </div>
        <div className="flex overflow-hidden rounded-full border border-app text-sm font-semibold">
          {(['main', 'map', 'compact'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-3.5 py-1.5 transition-colors ${
                view === v ? 'bg-brand-600 text-on-brand' : 'surface-elevated hover:bg-brand-50'
              }`}
            >
              {t(`hq.overview.views.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {/* KPI band — shared across all views */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label={t('hq.overview.kpi.revenue')}
          value={`Rp ${totalRevenue.toLocaleString('id-ID')}`}
          hint={t('hq.overview.kpiHint.orders', { n: totalOrders })}
        />
        <Stat label={t('hq.overview.kpi.orders')} value={totalOrders.toLocaleString('id-ID')} />
        <Stat
          label={t('hq.overview.kpi.sla')}
          value={slaPct != null ? `${slaPct}%` : t('hq.common.dash')}
          hint={
            deliverySla
              ? t('hq.overview.kpiHint.sla', { onTime: deliverySla.onTime, total: deliverySla.totalDelivered })
              : undefined
          }
        />
        <Stat
          label={t('hq.overview.kpi.activeDepots')}
          value={String(activeDepots)}
          hint={t('hq.overview.kpiHint.depots', { total: depots.length })}
        />
        <Stat
          label={t('hq.overview.kpi.newCustomers')}
          value={newCustomers.data ? newCustomers.data.count.toLocaleString('id-ID') : t('hq.common.dash')}
          hint={newCustomers.data ? t('hq.overview.kpiHint.newCustomers') : t('hq.overview.kpiHint.soon')}
        />
        <Stat
          label={t('hq.overview.kpi.pendingApproval')}
          value={pendingCount != null ? String(pendingCount) : t('hq.common.dash')}
          hint={pendingCount != null ? t('hq.overview.kpiHint.pendingApproval') : t('hq.overview.kpiHint.soon')}
        />
      </div>

      {unavailable.length > 0 && (
        <p className="text-sm text-amber-700" role="status">
          {t('hq.common.unavailableSome', { sources: unavailable.join(', ') })}
        </p>
      )}

      {view === 'main' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Depot performance table */}
          <Card className="flex flex-col p-5 lg:col-span-2">
            <h2 className="mb-3 font-semibold">{t('hq.overview.perf.title')}</h2>
            {rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">{t('hq.overview.perf.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-sm">
                  <thead>
                    <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                      <th className="pb-2 font-medium">{t('hq.overview.perf.depot')}</th>
                      <th className="pb-2 text-right font-medium">{t('hq.overview.perf.revenue')}</th>
                      <th className="pb-2 text-right font-medium">{t('hq.overview.perf.sla')}</th>
                      <th className="pb-2 text-right font-medium">{t('hq.overview.perf.orders')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--border)]">
                    {byRevenue.map((r) => (
                      <tr
                        key={r.depotId}
                        className="cursor-pointer transition-colors hover:bg-[color:var(--surface-soft)]"
                        onClick={() => router.push(`/hq/depots/${r.depotId}`)}
                      >
                        <td className="py-2.5 font-medium">{r.name}</td>
                        <td className="py-2.5 text-right">
                          <Money amount={r.revenue} />
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {r.sla != null ? `${Math.round(r.sla * 100)}%` : t('hq.common.dash')}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{r.orderCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Needs attention */}
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Warning size={18} weight="fill" className="text-amber-500" />
              {t('hq.overview.attention.title')}
            </h2>
            {lowSla.length === 0 && unavailable.length === 0 ? (
              <p className="text-sm text-muted">{t('hq.overview.attention.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {lowSla.map((r) => (
                  <li key={r.depotId} className="flex items-center justify-between gap-2 rounded-lg bg-[color:var(--warning-bg)] px-3 py-2">
                    <span className="min-w-0 truncate font-medium">{r.name}</span>
                    <span className="shrink-0 text-xs font-semibold text-[color:var(--warning)]">
                      {t('hq.overview.attention.lowSla', { v: Math.round(r.sla * 100) })}
                    </span>
                  </li>
                ))}
                {unavailable.map((s) => (
                  <li key={s} className="rounded-lg bg-[color:var(--surface-soft)] px-3 py-2 text-xs text-muted">
                    {t('hq.overview.attention.sourceDown', { name: s })}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {view === 'map' && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t('hq.overview.map.active')} value={String(activeDepots)} />
            <Stat label={t('hq.overview.map.revenue')} value={`Rp ${totalRevenue.toLocaleString('id-ID')}`} />
            <Stat label={t('hq.overview.map.sla')} value={slaPct != null ? `${slaPct}%` : t('hq.common.dash')} />
          </div>
          {depots.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{t('hq.overview.perf.empty')}</p>
          ) : (
            <DepotMap depots={depots} onSelect={(d) => router.push(`/hq/depots/${d.id}`)} />
          )}
        </div>
      )}

      {view === 'compact' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="flex flex-col gap-2 p-5 lg:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t('hq.overview.compact.revenue')}
            </p>
            <p className="text-4xl font-extrabold tabular-nums">
              Rp {totalRevenue.toLocaleString('id-ID')}
            </p>
            <p className="text-sm text-muted">{t('hq.overview.compact.orders', { n: totalOrders })}</p>
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                {t('hq.overview.compact.trend')}
              </p>
              {buckets.length >= 2 ? (
                <Sparkline data={buckets.map((b) => b.revenue)} />
              ) : (
                <BarTrend data={buckets.map((b) => ({ label: b.period, value: b.revenue }))} />
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('hq.overview.compact.top')}
              </p>
              {byRevenue.slice(0, 3).map((r, i) => (
                <RankBar key={r.depotId} position={i} label={r.name} score={r.sla ?? 0} />
              ))}
            </div>
            {lowSla.length > 0 && (
              <div className="flex flex-col gap-2.5 border-t border-app pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {t('hq.overview.compact.bottom')}
                </p>
                {lowSla.slice(0, 3).map((r, i) => (
                  <RankBar key={r.depotId} position={i} label={r.name} score={r.sla} />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
