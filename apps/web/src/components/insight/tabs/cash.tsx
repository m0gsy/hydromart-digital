'use client';

import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { BUSINESS_TZ } from '@/lib/business-tz';
import { todayWib } from '@/lib/wib';
import type { CashierShift, DepotDailyReport } from '@/lib/types';

const dash = '—';
/** A figure the server could not read is a dash, never Rp 0. */
const money = (n: number | null | undefined): string => (n == null ? dash : formatIDR(n));

/** The time of day of an instant, in the business zone: "08.05". */
function clock(iso: string | null): string {
  if (!iso) return dash;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** Kas & Shift: who has the till, what each drawer settled at, and what the couriers brought back. */
export function CashTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, depotId } = ctx;
  const mayShifts = can('cashierShift', role);
  const mayDaily = can('orderReportsDepot', role);
  const today = todayWib();

  const shifts = useInsightData(
    () =>
      api.get<{ open: CashierShift[]; closed: CashierShift[] }>(
        endpoints.cashierShifts.list(depotId as string),
        true,
      ),
    [depotId],
    mayShifts && depotId != null,
  );
  const daily = useInsightData(
    () => api.get<DepotDailyReport>(endpoints.reports.depotDaily(depotId as string, today), true),
    [depotId, today],
    mayDaily && depotId != null,
  );

  const all = [...(shifts.data?.open ?? []), ...(shifts.data?.closed ?? [])];
  // Only a closed drawer has a variance: an open one has not been counted.
  const off = (shifts.data?.closed ?? []).filter((s) => s.variance != null && s.variance !== 0);

  return (
    <div className="flex flex-col gap-6">
      {(mayShifts || mayDaily) && depotId == null && (
        <p className="text-xs text-muted">{t('insight.cash.needDepot')}</p>
      )}

      {depotId != null && mayDaily && !daily.forbidden && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label={t('insight.cash.drawer')}
            value={money(daily.data?.cashInDrawerIdr)}
            hint={t('insight.cash.todayHint')}
            definition={t('insight.cash.drawerDef')}
          />
          <KpiCard
            label={t('insight.cash.cod')}
            value={money(daily.data?.codCollectedIdr)}
            hint={t('insight.cash.todayHint')}
            definition={t('insight.cash.codDef')}
          />
          {mayShifts && !shifts.forbidden && (
            <KpiCard
              label={t('insight.cash.shiftsOff')}
              value={shifts.data ? String(off.length) : dash}
              definition={t('insight.cash.shiftsOffDef')}
              tone={off.length > 0 ? 'danger' : undefined}
            />
          )}
        </section>
      )}

      {mayShifts && depotId != null && (
        <WidgetCard
          title={t('insight.cash.shiftsTitle')}
          source={shifts}
          isEmpty={() => all.length === 0}
          emptyText={t('insight.cash.shiftsEmpty')}
          detailHref="/dashboard/shift"
        >
          {() => (
            <div className="flex flex-col gap-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead>
                    <tr>
                      {['cashier', 'opened', 'closed', 'expected', 'counted', 'variance'].map(
                        (c, i) => (
                          <th
                            key={c}
                            scope="col"
                            className={`p-2 font-medium text-muted ${i === 0 ? 'text-left' : 'text-right'}`}
                          >
                            {t(`insight.cash.col.${c}`)}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {all.map((s) => (
                      <tr key={s.id}>
                        <th scope="row" className="p-2 text-left font-semibold">
                          {s.cashierName}
                          {s.status === 'OPEN' && (
                            <span className="ml-2 text-[11px] font-normal text-muted">
                              {t('insight.cash.open')}
                            </span>
                          )}
                        </th>
                        <td className="p-2 text-right tabular-nums">{clock(s.openedAt)}</td>
                        <td className="p-2 text-right tabular-nums">{clock(s.closedAt)}</td>
                        <td className="p-2 text-right tabular-nums">{money(s.expectedCash)}</td>
                        <td className="p-2 text-right tabular-nums">{money(s.countedCash)}</td>
                        <td
                          className={`p-2 text-right font-semibold tabular-nums ${
                            s.variance != null && s.variance !== 0
                              ? 'text-[color:var(--danger)]'
                              : ''
                          }`}
                        >
                          {money(s.variance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted">{t('insight.cash.shiftsNote')}</p>
            </div>
          )}
        </WidgetCard>
      )}

      {mayDaily && depotId != null && (
        <WidgetCard
          title={t('insight.cash.cashiersTitle')}
          source={daily}
          isEmpty={(d) => (d.perCashier ?? []).length === 0}
          emptyText={t('insight.cash.cashiersEmpty')}
          detailHref="/dashboard/reports"
        >
          {(d) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {(d.perCashier ?? []).map((c, i) => (
                <li key={c.cashierId ?? `none-${i}`} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">
                    {c.label ?? t('insight.cash.noCashier')}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatIDR(c.revenueIdr)}
                    <span className="ml-2 text-xs text-muted">
                      {t('insight.sales.customerOrders', { orders: c.orders })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      )}
    </div>
  );
}
