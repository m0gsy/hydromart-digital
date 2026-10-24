'use client';

import { DonutChart } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { WidgetCard } from '@/components/insight/widget-card';
import { PromoRoiCard } from '@/components/insight/widgets/promo-roi';
import { SalesForecastCard } from '@/components/insight/widgets/sales-forecast';
import { SalesSeriesCard } from '@/components/insight/widgets/sales-series';
import { Card, Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type {
  ExecutiveDashboard,
  RevenueByProduct,
  StatusSummary,
  UnsettledMethodBucket,
} from '@/lib/types';

/** A share as a whole percentage, or null when there is no total to take a share of. */
function share(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** Penjualan: how much sold, of what, how it was paid for, and by whom. */
export function SalesTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotIds, depotId } = ctx;
  const mayReports = can('orderReports', role);
  const mayMethods = can('settlementRead', role);
  const mayExecutive = can('dashboardFinance', role);
  // The dashboard's endpoint sends customer names to every role that reads it; the customer
  // directory is for fewer. A role without it sees the ranking as numbers, not as people.
  const mayNames = can('depotCrm', role);

  const products = useInsightData(
    () =>
      api.get<RevenueByProduct>(
        endpoints.reports.revenueByCategory({
          from: range.from,
          to: range.to,
          limit: 8,
          depotIds,
        }),
        true,
      ),
    [range.from, range.to, depotIds?.join(',')],
    mayReports,
  );
  // Payments carry no depot, so this is the network's. It does not follow the depot picker, and
  // the card says so rather than letting a depot's name sit above the whole network's figures.
  const methods = useInsightData(
    () =>
      api.get<UnsettledMethodBucket[]>(
        endpoints.payments.revenueByMethod({ from: range.from, to: range.to }),
        true,
      ),
    [range.from, range.to],
    mayMethods,
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

  const customers = exec.data?.topCustomers?.items ?? [];
  const topCustomerRevenue = Math.max(1, ...customers.map((c) => c.revenue));

  return (
    <div className="flex flex-col gap-6">
      <SalesSeriesCard ctx={ctx} detailHref="/hq/analytics" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mayReports && (
          <WidgetCard
            title={t('insight.sales.byProductTitle')}
            source={products}
            isEmpty={(d) => d.items.length === 0}
            detailHref="/hq/analytics"
          >
            {(d) => (
              <>
                <DonutChart
                  segments={d.items.map((i) => ({ label: i.productName, value: i.revenue }))}
                  total={t('insight.sales.byProductTotal')}
                  format={formatIDR}
                  ariaLabel={t('insight.sales.byProductAria')}
                />
                <p className="text-[11px] text-muted">{t('insight.sales.byProductNote')}</p>
              </>
            )}
          </WidgetCard>
        )}

        {mayMethods && (
          <WidgetCard
            title={t('insight.sales.byMethodTitle')}
            source={methods}
            isEmpty={(d) => d.length === 0}
            detailHref="/hq/payments"
          >
            {(d) => (
              <>
                <DonutChart
                  segments={d.map((m) => ({
                    label: t(`insight.method.${m.method}`),
                    value: m.amount,
                  }))}
                  total={t('insight.sales.byMethodTotal')}
                  format={formatIDR}
                  ariaLabel={t('insight.sales.byMethodAria')}
                />
                <p className="text-[11px] text-muted">{t('insight.sales.byMethodNote')}</p>
              </>
            )}
          </WidgetCard>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mayReports && (
          <WidgetCard
            title={t('insight.sales.channelTitle')}
            source={summary}
            isEmpty={(d) => d.window.walkIn + d.window.app === 0}
          >
            {(d) => {
              const total = d.window.walkIn + d.window.app;
              const app = share(d.window.app, total) ?? 0;
              return (
                <div className="flex flex-col gap-3">
                  <div
                    className="flex h-3 overflow-hidden rounded-full bg-[color:var(--surface-muted)]"
                    role="img"
                    aria-label={t('insight.sales.channelAria', {
                      app,
                      counter: 100 - app,
                    })}
                  >
                    <div className="bg-brand-600" style={{ width: `${app}%` }} />
                    <div className="bg-amber-500" style={{ width: `${100 - app}%` }} />
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                    <li className="flex justify-between gap-2">
                      <span>{t('insight.sales.channelApp')}</span>
                      <span className="tabular-nums">
                        {d.window.app} · {app}%
                      </span>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span>{t('insight.sales.channelCounter')}</span>
                      <span className="tabular-nums">
                        {d.window.walkIn} · {100 - app}%
                      </span>
                    </li>
                  </ul>
                </div>
              );
            }}
          </WidgetCard>
        )}

        {mayExecutive && (
          <WidgetCard
            title={t('insight.sales.topCustomersTitle')}
            source={exec}
            isEmpty={() => customers.length === 0}
            detailHref={mayNames ? '/hq/customers' : undefined}
          >
            {() => (
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {customers.slice(0, 5).map((c, n) => (
                  <li key={c.customerId} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {mayNames
                          ? (c.customerName ?? t('insight.sales.unnamed'))
                          : t('insight.sales.customerNumber', { n: n + 1 })}
                      </span>
                      <Money amount={c.revenue} className="shrink-0 text-sm font-bold" />
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{
                          width: `${Math.max(0, Math.round((c.revenue / topCustomerRevenue) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="text-[11px] text-muted">
                      {t('insight.sales.customerOrders', { orders: c.orderCount })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </WidgetCard>
        )}
      </div>

      <PromoRoiCard ctx={ctx} />
      <SalesForecastCard ctx={ctx} />

      {!mayReports && !mayMethods && !mayExecutive && (
        <Card className="p-4 text-sm text-muted">{t('insight.denied')}</Card>
      )}
    </div>
  );
}
