'use client';

import { useMemo } from 'react';

import { GaugeChart } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { SalesSeriesCard } from '@/components/insight/widgets/sales-series';
import { RecentActivityCard } from '@/components/insight/widgets/recent-activity';
import { DepotMapCard } from '@/components/insight/widgets/depot-map';
import { UnavailableCard } from '@/components/insight/widgets/unavailable';
import { WidgetCard } from '@/components/insight/widget-card';
import { Card, Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { compare } from '@/lib/insight/delta';
import type { InsightRange } from '@/lib/insight/range';
import { overviewSentence } from '@/lib/insight/sentences';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useOpenIncidents } from '@/lib/insight/use-open-incidents';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { monthWib } from '@/lib/wib';
import type {
  ApprovalCounts,
  DepotTarget,
  ExecutiveDashboard,
  NetworkDashboard,
  RatingByDepotReport,
  StatusSummary,
} from '@/lib/types';

/** Revenue and orders of a window, as the executive dashboard's buckets add up. */
function totalsOf(exec: ExecutiveDashboard | null): { revenue: number; orders: number } | null {
  if (!exec?.sales) return null;
  return {
    revenue: exec.sales.buckets.reduce((n, b) => n + b.revenue, 0),
    orders: exec.sales.buckets.reduce((n, b) => n + b.orderCount, 0),
  };
}

/** The share of delivered orders that were on time, or null when nothing was delivered. */
function slaOf(exec: ExecutiveDashboard | null): number | null {
  const sla = exec?.deliverySla;
  return sla && sla.totalDelivered > 0 ? sla.slaRate : null;
}

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

function Attention({
  label,
  hint,
  value,
  danger,
}: {
  label: string;
  hint: string;
  value: number;
  danger: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-[color:var(--surface-muted)] p-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${danger ? 'text-[color:var(--danger)]' : ''}`}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted">{hint}</p>
    </div>
  );
}

/** Ringkasan: the headline numbers, how they moved, and what needs doing now. */
export function OverviewTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, prev, year, partial, comparable, depotIds, depotId } = ctx;
  const mayReports = can('orderReports', role);
  const mayExecutive = can('dashboardFinance', role);
  const mayTargets = can('depotTargets', role);
  const mayApprovals = can('approvals', role);
  const mayIncidents = can('incidents', role);

  const exec = (r: InsightRange) => () =>
    api.get<ExecutiveDashboard>(
      endpoints.dashboard.executive({ from: r.from, to: r.to, depotId: depotId ?? undefined }),
      true,
    );
  const execNow = useInsightData(exec(range), [range.from, range.to, depotId], mayExecutive);
  const execPrev = useInsightData(
    exec(prev),
    [prev.from, prev.to, depotId],
    mayExecutive && comparable,
  );
  const execYear = useInsightData(
    exec(year),
    [year.from, year.to, depotId],
    mayExecutive && comparable,
  );

  const network = useInsightData(
    () => api.get<NetworkDashboard>(endpoints.hq.rollup({ from: range.from, to: range.to }), true),
    [range.from, range.to],
    mayExecutive,
  );
  const summary = useInsightData(
    () =>
      api.get<StatusSummary>(
        endpoints.reports.statusSummary({ from: range.from, to: range.to, depotIds }),
        true,
      ),
    [range.from, range.to, depotIds?.join(',')],
    mayReports,
  );
  const rating = useInsightData(
    () =>
      api.get<RatingByDepotReport>(
        endpoints.reports.ratingByDepot({ from: range.from, to: range.to }),
        true,
      ),
    [range.from, range.to],
    mayReports,
  );

  // The target is monthly: it is only comparable with a window that IS that month, for one depot.
  const targetMonth = range.preset === 'month' ? monthWib(new Date(range.from)) : null;
  const target = useInsightData(
    () =>
      api.get<DepotTarget | null>(
        endpoints.depotTargets.get({ depotId: depotId as string, month: targetMonth as string }),
        true,
      ),
    [depotId, targetMonth],
    mayTargets && depotId != null && targetMonth != null,
  );
  const openIncidents = useOpenIncidents(depotId, mayIncidents);
  const approvals = useInsightData(
    () => api.get<ApprovalCounts>(endpoints.approvals.counts(depotId as string), true),
    [depotId],
    mayApprovals && depotId != null,
  );

  const now = totalsOf(execNow.data);
  const before = totalsOf(execPrev.data);
  const lastYear = totalsOf(execYear.data);
  const aov = (x: { revenue: number; orders: number } | null): number | null =>
    x && x.orders > 0 ? x.revenue / x.orders : null;

  const revenueDeltas = {
    prev: compare(now?.revenue ?? null, before?.revenue ?? null),
    year: compare(now?.revenue ?? null, lastYear?.revenue ?? null),
  };
  const ordersDeltas = {
    prev: compare(now?.orders ?? null, before?.orders ?? null),
    year: compare(now?.orders ?? null, lastYear?.orders ?? null),
  };
  const aovDeltas = {
    prev: compare(aov(now), aov(before)),
    year: compare(aov(now), aov(lastYear)),
  };
  const slaNow = slaOf(execNow.data);
  const slaDeltas = {
    prev: compare(slaNow, slaOf(execPrev.data)),
    year: compare(slaNow, slaOf(execYear.data)),
  };

  const weightedRating = useMemo(() => {
    const items = (rating.data?.items ?? []).filter(
      (i) => depotId == null || i.depotId === depotId,
    );
    const reviews = items.reduce((n, i) => n + i.reviewCount, 0);
    if (reviews === 0) return null;
    return {
      value: items.reduce((n, i) => n + i.rating * i.reviewCount, 0) / reviews,
      reviews,
    };
  }, [rating.data, depotId]);

  const sentence = overviewSentence(revenueDeltas.prev, ordersDeltas.prev);

  const rows = (network.data?.depots ?? [])
    .filter((d) => depotId == null || d.depotId === depotId)
    .filter((d) => d.revenue != null)
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
    .slice(0, 5);
  const topRevenue = Math.max(1, ...rows.map((d) => d.revenue ?? 0));
  const lowStock = (network.data?.depots ?? [])
    .filter((d) => depotId == null || d.depotId === depotId)
    .reduce((n, d) => n + d.lowStockCount, 0);

  const showKpis = mayExecutive && !execNow.forbidden;
  const dash = '—';

  return (
    <div className="flex flex-col gap-6">
      {sentence && (
        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold">{t('insight.overview.insightTitle')}</h2>
          <p className="text-sm">{t(sentence.key, sentence.vars)}</p>
        </Card>
      )}

      {showKpis && partial && comparable && (
        <p className="text-xs text-muted">{t('insight.compare.partial')}</p>
      )}

      {showKpis && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label={t('insight.kpi.revenue')}
            value={now ? formatIDR(now.revenue) : dash}
            definition={t('insight.kpi.revenueDef')}
            deltas={revenueDeltas}
          />
          <KpiCard
            label={t('insight.kpi.orders')}
            value={now ? String(now.orders) : dash}
            definition={t('insight.kpi.ordersDef')}
            deltas={ordersDeltas}
          />
          <KpiCard
            label={t('insight.kpi.aov')}
            value={aov(now) != null ? formatIDR(Math.round(aov(now) as number)) : dash}
            definition={t('insight.kpi.aovDef')}
            deltas={aovDeltas}
          />
          <KpiCard
            label={t('insight.kpi.sla')}
            value={slaNow != null ? pct(slaNow) : dash}
            hint={
              execNow.data?.deliverySla?.avgMinutes != null && slaNow != null
                ? t('insight.kpi.minutes', {
                    minutes: Math.round(execNow.data.deliverySla.avgMinutes),
                  })
                : undefined
            }
            definition={t('insight.kpi.slaDef')}
            deltas={slaDeltas}
          />
          {mayReports && !summary.forbidden && (
            <KpiCard
              label={t('insight.kpi.cancelRate')}
              value={
                summary.data?.window.cancelRate != null ? pct(summary.data.window.cancelRate) : dash
              }
              definition={t('insight.kpi.cancelRateDef')}
              goodWhen="down"
            />
          )}
          {mayReports && !rating.forbidden && (
            <KpiCard
              label={t('insight.kpi.rating')}
              value={weightedRating ? weightedRating.value.toFixed(2).replace('.', ',') : dash}
              hint={
                weightedRating
                  ? t('insight.kpi.reviews', { count: weightedRating.reviews })
                  : undefined
              }
              definition={t('insight.kpi.ratingDef')}
            />
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SalesSeriesCard ctx={ctx} detailHref="/hq/analytics" className="lg:col-span-2" />

        {mayTargets && mayExecutive && now != null && depotId != null && targetMonth != null && (
          <WidgetCard
            title={t('insight.overview.targetTitle')}
            source={target}
            emptyText={t('insight.overview.targetEmpty')}
            detailHref="/dashboard/targets"
          >
            {(d) => (
              <GaugeChart
                value={now?.revenue ?? 0}
                max={d?.revenueTargetIdr ?? 0}
                caption={t('insight.overview.targetCaption', {
                  value: formatIDR(now?.revenue ?? 0),
                  target: formatIDR(d?.revenueTargetIdr ?? 0),
                })}
                ariaLabel={t('insight.overview.targetAria')}
              />
            )}
          </WidgetCard>
        )}
      </div>

      {mayTargets && mayExecutive && (depotId == null || targetMonth == null) && (
        <p className="text-xs text-muted">
          {depotId == null
            ? t('insight.overview.targetNeedDepot')
            : t('insight.overview.targetNeedMonth')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {mayExecutive && (
          <WidgetCard
            title={t('insight.overview.topDepotsTitle')}
            source={network}
            isEmpty={() => rows.length === 0}
            detailHref="/hq/scorecard"
            className="lg:col-span-2"
          >
            {() => (
              <ol className="flex flex-col gap-3">
                {rows.map((d) => (
                  <li key={d.depotId} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{d.name}</span>
                      <Money amount={d.revenue ?? 0} className="shrink-0 text-sm font-bold" />
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{ width: `${Math.round(((d.revenue ?? 0) / topRevenue) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted">
                      {t('insight.overview.topDepotsCaption', { orders: d.orderCount ?? 0 })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </WidgetCard>
        )}

        {(mayReports || mayExecutive || ((mayApprovals || mayIncidents) && depotId != null)) && (
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold">{t('insight.overview.attentionTitle')}</h2>
            {(() => {
              const unrouted = summary.data?.live.unrouted ?? 0;
              const waiting = approvals.data?.total ?? 0;
              const incidentCount = openIncidents.incidents.length;
              // "All clear" is a claim about every source: one that failed, or is still loading,
              // is not a zero. Only sources this role asks (and is allowed) count.
              const answered =
                (!mayReports || summary.forbidden || summary.data != null) &&
                (!mayExecutive || network.forbidden || network.data != null) &&
                (!(mayApprovals && depotId != null) ||
                  approvals.forbidden ||
                  approvals.data != null) &&
                (!(mayIncidents && depotId != null) ||
                  openIncidents.source.forbidden ||
                  openIncidents.source.data != null);
              const none =
                answered &&
                unrouted === 0 &&
                lowStock === 0 &&
                waiting === 0 &&
                incidentCount === 0;
              return (
                <>
                  {none && (
                    <p className="text-xs text-muted">{t('insight.overview.attentionNone')}</p>
                  )}
                  {summary.data && (
                    <Attention
                      label={t('insight.overview.unrouted')}
                      hint={t('insight.overview.unroutedHint')}
                      value={unrouted}
                      danger={unrouted > 0}
                    />
                  )}
                  {network.data && (
                    <Attention
                      label={t('insight.overview.lowStock')}
                      hint={t('insight.overview.lowStockHint')}
                      value={lowStock}
                      danger={lowStock > 0}
                    />
                  )}
                  {openIncidents.source.data && (
                    <Attention
                      label={t('insight.overview.incidents')}
                      hint={t('insight.overview.incidentsHint', { n: openIncidents.high })}
                      value={incidentCount}
                      danger={openIncidents.high > 0}
                    />
                  )}
                  {approvals.data && (
                    <Attention
                      label={t('insight.overview.approvals')}
                      hint={t('insight.overview.approvalsHint')}
                      value={waiting}
                      danger={waiting > 0}
                    />
                  )}
                </>
              );
            })()}
          </Card>
        )}
      </div>
      <RecentActivityCard ctx={ctx} />
      <DepotMapCard ctx={ctx} />
      <UnavailableCard />
    </div>
  );
}
