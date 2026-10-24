'use client';

import { HourChart } from '@/components/dashboard/hour-chart';
import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { todayWib } from '@/lib/wib';
import type {
  DepotDailyReport,
  ExecutiveDashboard,
  InventoryItem,
  NetworkDashboard,
  StatusSummary,
} from '@/lib/types';

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
const dash = '—';

/** The statuses an order passes through before it is delivered, in the order it passes them. */
const IN_FLIGHT = [
  'CREATED',
  'CONFIRMED',
  'PREPARING',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'ON_DELIVERY',
] as const;

/** Operasional: what is moving right now, how well deliveries are going, and what is running out. */
export function OperationsTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotIds, depotId, depotNames } = ctx;
  const mayReports = can('orderReports', role);
  const mayExecutive = can('dashboardFinance', role);
  const mayDaily = can('orderReportsDepot', role);
  const mayStock = can('inventoryRead', role);

  const summary = useInsightData(
    () =>
      api.get<StatusSummary>(
        endpoints.reports.statusSummary({ from: range.from, to: range.to, depotIds }),
        true,
      ),
    [range.from, range.to, depotIds?.join(',')],
    mayReports,
  );
  const exec = useInsightData(
    () =>
      api.get<ExecutiveDashboard>(
        endpoints.dashboard.executive({
          from: range.from,
          to: range.to,
          depotId: depotId ?? undefined,
        }),
        true,
      ),
    [range.from, range.to, depotId],
    mayExecutive,
  );
  const network = useInsightData(
    () => api.get<NetworkDashboard>(endpoints.hq.rollup({ from: range.from, to: range.to }), true),
    [range.from, range.to],
    mayExecutive,
  );
  // Orders by hour is one depot's day: it needs a depot, and it is always TODAY, whatever the
  // window above is, because "when is it busy" is a question about the day in progress.
  const today = todayWib();
  const daily = useInsightData(
    () => api.get<DepotDailyReport>(endpoints.reports.depotDaily(depotId as string, today), true),
    [depotId, today],
    mayDaily && depotId != null,
  );
  const stock = useInsightData(
    () => api.get<InventoryItem[]>(endpoints.inventory.lowStock(depotId ?? undefined), true),
    [depotId],
    mayStock,
  );

  const live = summary.data?.live;
  const sla = exec.data?.deliverySla ?? null;
  const slaRate = sla && sla.totalDelivered > 0 ? sla.slaRate : null;
  // Worst first: the ten shown are the ten closest to (or furthest under) their minimum.
  const lowStock = (stock.data ?? [])
    .filter((i) => !i.hidden)
    .sort((a, b) => a.available - a.minimumStock - (b.available - b.minimumStock));
  const slaRows = (network.data?.depots ?? [])
    .filter((d) => depotId == null || d.depotId === depotId)
    // Worst first, and a depot with no deliveries at the end: it is unmeasured, not the best.
    .sort((a, b) => (a.slaRate ?? 2) - (b.slaRate ?? 2));

  return (
    <div className="flex flex-col gap-6">
      {((mayReports && !summary.forbidden) || (mayExecutive && !exec.forbidden)) && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mayReports && !summary.forbidden && (
            <>
              <KpiCard
                label={t('insight.ops.inProgress')}
                value={live ? String(live.inProgress) : dash}
                definition={t('insight.ops.inProgressDef')}
              />
              <KpiCard
                label={t('insight.overview.unrouted')}
                value={live ? String(live.unrouted) : dash}
                definition={t('insight.overview.unroutedHint')}
                tone={live && live.unrouted > 0 ? 'danger' : undefined}
              />
              <KpiCard
                label={t('insight.kpi.cancelRate')}
                value={
                  summary.data?.window.cancelRate != null
                    ? pct(summary.data.window.cancelRate)
                    : dash
                }
                definition={t('insight.kpi.cancelRateDef')}
                goodWhen="down"
              />
              <KpiCard
                label={t('insight.ops.completed')}
                value={summary.data ? String(summary.data.window.completed) : dash}
                definition={t('insight.ops.completedDef')}
              />
            </>
          )}
          {mayExecutive && !exec.forbidden && (
            <KpiCard
              label={t('insight.kpi.sla')}
              value={slaRate != null ? pct(slaRate) : dash}
              hint={
                sla?.avgMinutes != null && slaRate != null
                  ? t('insight.kpi.minutes', { minutes: Math.round(sla.avgMinutes) })
                  : undefined
              }
              definition={t('insight.kpi.slaDef')}
            />
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mayReports && (
          <WidgetCard
            title={t('insight.ops.flightTitle')}
            source={summary}
            isEmpty={(d) => d.live.inProgress === 0}
            emptyText={t('insight.ops.flightEmpty')}
            detailHref="/dashboard/orders"
          >
            {(d) => (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {IN_FLIGHT.map((status) => (
                  <li key={status} className="flex justify-between gap-2">
                    <span>{t(`insight.status.${status}`)}</span>
                    <span className="font-semibold tabular-nums">
                      {d.live.byStatus[status] ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}

        {mayDaily && depotId != null && (
          <WidgetCard
            title={t('insight.ops.hoursTitle')}
            source={daily}
            isEmpty={(d) => d.byHour.every((h) => h.orders === 0)}
            emptyText={t('insight.ops.hoursEmpty')}
            detailHref="/dashboard/reports"
          >
            {(d) => <HourChart hours={d.byHour} />}
          </WidgetCard>
        )}
        {mayDaily && depotId == null && (
          <p className="self-center text-xs text-muted">{t('insight.ops.hoursNeedDepot')}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mayExecutive && (
          <WidgetCard
            title={t('insight.ops.slaTitle')}
            source={network}
            isEmpty={() => slaRows.length === 0}
            detailHref="/hq/scorecard"
          >
            {() => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {slaRows.map((d) => (
                  <li key={d.depotId} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-semibold">{d.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {d.slaRate != null ? pct(d.slaRate) : dash}
                      <span className="ml-2 text-xs text-muted">
                        {d.avgMinutes != null
                          ? t('insight.kpi.minutes', { minutes: Math.round(d.avgMinutes) })
                          : t('insight.ops.noDeliveries')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}

        {mayStock && (
          <WidgetCard
            title={t('insight.ops.stockTitle')}
            source={stock}
            isEmpty={() => lowStock.length === 0}
            emptyText={t('insight.ops.stockEmpty')}
            detailHref="/hq/inventory"
          >
            {() => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {lowStock.slice(0, 10).map((i) => (
                  <li key={i.id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{i.label}</span>
                      {depotNames[i.depotId] && (
                        <span className="ml-2 text-xs text-muted">{depotNames[i.depotId]}</span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-[color:var(--danger)]">
                      {t('insight.ops.stockLine', { qty: i.available, min: i.minimumStock })}
                    </span>
                  </li>
                ))}
                {lowStock.length > 10 && (
                  <li className="text-xs text-muted">
                    {t('insight.ops.stockMore', { count: lowStock.length - 10 })}
                  </li>
                )}
              </ul>
            )}
          </WidgetCard>
        )}
      </div>
    </div>
  );
}
