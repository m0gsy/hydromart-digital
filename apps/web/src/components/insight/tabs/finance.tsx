'use client';

import { HeatTable } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { monthWib } from '@/lib/wib';
import type {
  NetworkPnl,
  NetworkPnlDepotRow,
  OperationalMonthlyPnl,
  Page,
  RefundQueueItem,
  UnsettledAging,
  UnsettledMethodBucket,
} from '@/lib/types';

const dash = '—';
/** A money figure that may be missing: null is "could not be read", never zero. */
const money = (n: number | null | undefined): string => (n == null ? dash : formatIDR(n));

/** The cost columns the network table shows. Refunds and net profit are left out on purpose (see the note). */
const COST_COLUMNS: { key: keyof NetworkPnlDepotRow; label: string }[] = [
  { key: 'revenueIdr', label: 'insight.finance.col.revenue' },
  { key: 'cogsIdr', label: 'insight.finance.col.cogs' },
  { key: 'payrollIdr', label: 'insight.finance.col.payroll' },
  { key: 'courierCommissionIdr', label: 'insight.finance.col.commission' },
  { key: 'expenseClaimIdr', label: 'insight.finance.col.claims' },
];

/** Keuangan: money waiting to be settled, how long it has waited, and what a depot earned. */
export function FinanceTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotId } = ctx;
  const maySettle = can('settlementRead', role);
  const mayRefunds = can('refundQueueRead', role);
  const mayPnl = can('dashboard', role);
  // A P&L is a month. The window's first day names it, and the screen says which when the
  // window is not itself a month, so a week or a custom range is never mistaken for one.
  const month = monthWib(new Date(range.from));
  const monthIsWindow = range.preset === 'month';

  const unsettled = useInsightData(
    () =>
      api.get<UnsettledMethodBucket[]>(
        endpoints.payments.unsettledByMethod({ from: range.from, to: range.to }),
        true,
      ),
    [range.from, range.to],
    maySettle,
  );
  const aging = useInsightData(
    () => api.get<UnsettledAging>(endpoints.payments.unsettledAging, true),
    [],
    maySettle,
  );
  const refunds = useInsightData(
    () => api.get<Page<RefundQueueItem>>(endpoints.refunds.queue({ limit: 1 }), true),
    [],
    mayRefunds,
  );
  const depotPnl = useInsightData(
    () =>
      api.get<OperationalMonthlyPnl>(
        endpoints.dashboard.monthlyPnl(depotId as string, month),
        true,
      ),
    [depotId, month],
    mayPnl && depotId != null,
  );
  const network = useInsightData(
    () => api.get<NetworkPnl>(endpoints.dashboard.networkPnl(month), true),
    [month],
    mayPnl,
  );

  const waiting = (unsettled.data ?? []).reduce((n, b) => n + b.amount, 0);
  const waitingCount = (unsettled.data ?? []).reduce((n, b) => n + b.count, 0);
  const rows = (network.data?.depots ?? []).filter((d) => depotId == null || d.depotId === depotId);

  return (
    <div className="flex flex-col gap-6">
      {mayPnl && !monthIsWindow && (
        <p className="text-xs text-muted">{t('insight.finance.monthNote', { month })}</p>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {maySettle && !unsettled.forbidden && (
          <KpiCard
            label={t('insight.finance.waiting')}
            value={unsettled.data ? formatIDR(waiting) : dash}
            hint={
              unsettled.data ? t('insight.finance.waitingCount', { n: waitingCount }) : undefined
            }
            definition={t('insight.finance.waitingDef')}
          />
        )}
        {mayRefunds && !refunds.forbidden && (
          <KpiCard
            label={t('insight.finance.refundQueue')}
            value={refunds.data ? String(refunds.data.total) : dash}
            definition={t('insight.finance.refundQueueDef')}
            tone={refunds.data && refunds.data.total > 0 ? 'danger' : undefined}
          />
        )}
        {mayPnl && depotId != null && !depotPnl.forbidden && (
          <>
            <KpiCard
              label={t('insight.finance.col.revenue')}
              value={money(depotPnl.data?.revenueIdr)}
              definition={t('insight.kpi.revenueDef')}
            />
            <KpiCard
              label={t('insight.finance.operatingProfit')}
              value={money(depotPnl.data?.netOperatingProfitIdr)}
              hint={
                depotPnl.data == null
                  ? undefined
                  : depotPnl.data.netOperatingProfitIdr == null
                    ? t('insight.finance.costsIncomplete')
                    : depotPnl.data.marginPct != null
                      ? t('insight.finance.margin', { pct: Math.round(depotPnl.data.marginPct) })
                      : undefined
              }
              definition={t('insight.finance.operatingProfitDef')}
            />
          </>
        )}
      </section>

      {mayPnl && depotId == null && (
        <p className="text-xs text-muted">{t('insight.finance.needDepot')}</p>
      )}

      {maySettle && (
        <WidgetCard
          title={t('insight.finance.agingTitle')}
          source={aging}
          isEmpty={(d) => d.rows.length === 0}
          emptyText={t('insight.finance.agingEmpty')}
          detailHref="/hq/payments"
        >
          {(d) => (
            <div className="flex flex-col gap-2">
              <HeatTable
                columns={d.buckets.map((b) => t('insight.finance.days', { range: b }))}
                rows={d.rows.map((r) => ({
                  label: t(`insight.method.${r.method}`),
                  values: r.amounts,
                }))}
                format={formatIDR}
                rowHeader={t('insight.finance.method')}
                totalLabel={t('insight.finance.total')}
                ariaLabel={t('insight.finance.agingAria')}
              />
              <p className="text-[11px] text-muted">{t('insight.finance.agingNote')}</p>
            </div>
          )}
        </WidgetCard>
      )}

      {mayPnl && (
        <WidgetCard
          title={t('insight.finance.networkTitle', { month })}
          source={network}
          isEmpty={() => rows.length === 0}
          detailHref="/hq/pnl"
        >
          {(d) => (
            <div className="flex flex-col gap-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead>
                    <tr>
                      <th scope="col" className="p-2 text-left font-medium text-muted">
                        {t('insight.finance.depot')}
                      </th>
                      {COST_COLUMNS.map((c) => (
                        <th
                          key={c.key}
                          scope="col"
                          className="p-2 text-right font-medium text-muted"
                        >
                          {t(c.label)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.depotId}>
                        <th scope="row" className="p-2 text-left font-semibold">
                          {r.name}
                        </th>
                        {COST_COLUMNS.map((c) => (
                          <td key={c.key} className="p-2 text-right tabular-nums">
                            {money(r[c.key] as number | null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {depotId == null && (
                    <tfoot>
                      <tr>
                        <th scope="row" className="p-2 text-left font-bold">
                          {t('insight.finance.total')}
                        </th>
                        {COST_COLUMNS.map((c) => (
                          <td key={c.key} className="p-2 text-right font-bold tabular-nums">
                            {money(d.totals[c.key as keyof typeof d.totals] as number | null)}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <p className="text-[11px] text-muted">{t('insight.finance.networkNote')}</p>
            </div>
          )}
        </WidgetCard>
      )}
    </div>
  );
}
