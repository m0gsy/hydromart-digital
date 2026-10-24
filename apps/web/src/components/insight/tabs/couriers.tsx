'use client';

import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { dayStartWib, todayWib } from '@/lib/wib';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { CommissionRun, Customer, DepotTeamReport, Shift } from '@/lib/types';

const dash = '—';
const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

/** Armada & Kurir: who is on shift, how each courier is doing, and what the month's runs earned. */
export function CouriersTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotId } = ctx;
  const mayTrack = can('trackingRead', role);
  const mayTeam = can('deliveryReports', role);
  const mayPay = can('courierSettle', role);
  // Shifts on duty are a today question; the server filters on check-in and has no default
  // window, so the start of today is always sent.
  const dayStart = dayStartWib(todayWib());

  const onDuty = useInsightData(
    () => api.get<Shift[]>(endpoints.deliveries.shiftsOnDuty(dayStart, depotId ?? undefined), true),
    [dayStart, depotId],
    mayTrack,
  );
  const team = useInsightData(
    () =>
      api.get<DepotTeamReport>(
        endpoints.deliveries.depotTeam(depotId as string, { from: range.from, to: range.to }),
        true,
      ),
    [depotId, range.from, range.to],
    mayTeam && depotId != null,
  );
  const commission = useInsightData(
    () =>
      api.get<CommissionRun>(
        endpoints.deliveries.commission(depotId as string, { from: range.from, to: range.to }),
        true,
      ),
    [depotId, range.from, range.to],
    mayPay && depotId != null,
  );
  // Names for the ids the other answers carry. Failing to get them only costs the names.
  const names = useInsightData(
    () => api.get<Customer[]>(endpoints.auth.driversAt(depotId as string), true),
    [depotId],
    (mayTeam || mayPay) && depotId != null,
  );
  const nameOf = (id: string): string => {
    const found = (names.data ?? []).find((c) => c.id === id)?.fullName;
    return found ?? t('insight.couriers.unknown', { id: id.slice(0, 6) });
  };

  const active = (onDuty.data ?? []).filter((s) => s.status !== 'ENDED');
  const count = (status: Shift['status']) => active.filter((s) => s.status === status).length;

  return (
    <div className="flex flex-col gap-6">
      {(mayTeam || mayPay) && depotId == null && (
        <p className="text-xs text-muted">{t('insight.couriers.needDepot')}</p>
      )}

      {mayTrack && !onDuty.forbidden && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['ONLINE', 'BREAK', 'OFFLINE'] as const).map((status) => (
            <KpiCard
              key={status}
              label={t(`insight.couriers.status.${status}`)}
              value={onDuty.data ? String(count(status)) : dash}
              hint={t('insight.couriers.todayHint')}
              definition={t(`insight.couriers.statusDef.${status}`)}
            />
          ))}
        </section>
      )}

      {mayTeam && depotId != null && (
        <WidgetCard
          title={t('insight.couriers.teamTitle')}
          source={team}
          isEmpty={(d) => d.couriers.length === 0}
          emptyText={t('insight.couriers.teamEmpty')}
          detailHref="/dashboard/team-performance"
        >
          {(d) => (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-xs">
                <thead>
                  <tr>
                    {['courier', 'delivered', 'onTime', 'failed', 'rating'].map((c, i) => (
                      <th
                        key={c}
                        scope="col"
                        className={`p-2 font-medium text-muted ${i === 0 ? 'text-left' : 'text-right'}`}
                      >
                        {t(`insight.couriers.col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.couriers.map((c) => (
                    <tr key={c.driverId}>
                      <th scope="row" className="p-2 text-left font-semibold">
                        {nameOf(c.driverId)}
                      </th>
                      <td className="p-2 text-right tabular-nums">{c.delivered}</td>
                      <td className="p-2 text-right tabular-nums">
                        {c.delivered > 0 ? pct(c.onTimeRate) : dash}
                      </td>
                      <td
                        className={`p-2 text-right tabular-nums ${
                          c.failed > 0 ? 'text-[color:var(--danger)]' : ''
                        }`}
                      >
                        {c.failed}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {c.rating != null ? c.rating.toFixed(1).replace('.', ',') : dash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WidgetCard>
      )}

      {mayPay && depotId != null && (
        <WidgetCard
          title={t('insight.couriers.commissionTitle')}
          source={commission}
          // An unreadable payout service answers with no couriers and a null total: that is
          // "could not read", not "no commission".
          isEmpty={(d) => d.couriers.length === 0 && d.totalIdr != null}
          emptyText={t('insight.couriers.commissionEmpty')}
          detailHref="/dashboard/commission"
        >
          {(d) => (
            <div className="flex flex-col gap-2">
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {d.couriers.map((c) => (
                  <li key={c.courierId} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{nameOf(c.courierId)}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatIDR(c.netIdr)}
                      {c.shortfallIdr > 0 && (
                        <span className="ml-2 text-xs text-[color:var(--danger)]">
                          {t('insight.couriers.shortfall', { amount: formatIDR(c.shortfallIdr) })}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {d.totalIdr == null ? (
                <p role="status" className="text-[11px] text-muted">
                  {t('insight.couriers.commissionUnavailable')}
                </p>
              ) : (
                <p className="text-sm font-bold tabular-nums">
                  {t('insight.finance.total')}: {formatIDR(d.totalIdr)}
                </p>
              )}
            </div>
          )}
        </WidgetCard>
      )}
    </div>
  );
}
