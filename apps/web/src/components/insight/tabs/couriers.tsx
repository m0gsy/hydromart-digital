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
import type {
  CashSettlement,
  CommissionRun,
  UnsettledCodReport,
  Customer,
  DepotTeamReport,
  Delivery,
  Page,
  Shift,
} from '@/lib/types';

const dash = '—';
/** Whole days from an instant to now, never negative. */
const daysSince = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
/** Deliveries a courier still has to finish: assigned, picked up, or on the road. */
const IN_HAND = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'] as const;
/** One page is all the board reads; more than this is said, not hidden. */
const WORKLOAD_PAGE = 100;
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
  const mayLoad = can('trackingRead', role) && depotId != null;
  const load = useInsightData(
    () =>
      api.get<Page<Delivery>>(
        endpoints.deliveries.list({
          statuses: IN_HAND,
          depotId: depotId as string,
          limit: WORKLOAD_PAGE,
        }),
        true,
      ),
    [depotId],
    mayLoad,
  );
  const deposits = useInsightData(
    () =>
      api.get<CashSettlement[]>(
        endpoints.settlements.list({ depotId: depotId as string, status: 'SUBMITTED' }),
        true,
      ),
    [depotId],
    mayPay && depotId != null,
  );
  const heldCash = useInsightData(
    () => api.get<UnsettledCodReport>(endpoints.settlements.unsettled(depotId as string), true),
    [depotId],
    mayPay && depotId != null,
  );
  // Failed deliveries come newest first; the list has no date filter, so the window is applied here.
  const failed = useInsightData(
    () =>
      api.get<Page<Delivery>>(
        endpoints.deliveries.list({
          status: 'FAILED',
          depotId: depotId as string,
          limit: WORKLOAD_PAGE,
        }),
        true,
      ),
    [depotId],
    mayLoad,
  );
  const disputed = useInsightData(
    () =>
      api.get<CashSettlement[]>(
        endpoints.settlements.list({ depotId: depotId as string, status: 'DISPUTED' }),
        true,
      ),
    [depotId],
    mayPay && depotId != null,
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

  // Deliveries in hand per courier, busiest first.
  const perCourier = new Map<string, number>();
  for (const d of load.data?.items ?? []) {
    perCourier.set(d.driverId, (perCourier.get(d.driverId) ?? 0) + 1);
  }
  const loadRows = [...perCourier].sort((a, b) => b[1] - a[1]);
  const loadTruncated = load.data != null && load.data.total > load.data.items.length;
  const failedInRange = (failed.data?.items ?? []).filter(
    (d) =>
      d.failedAt != null &&
      Date.parse(d.failedAt) >= Date.parse(range.from) &&
      Date.parse(d.failedAt) < Date.parse(range.to),
  );
  const byReason = new Map<string, { label: string; n: number }>();
  for (const d of failedInRange) {
    const label = (d.failureReason ?? '').trim().slice(0, 60);
    const key = label.toLowerCase();
    const cur = byReason.get(key);
    byReason.set(key, { label: cur?.label ?? label, n: (cur?.n ?? 0) + 1 });
  }
  const reasons = [...byReason.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  // Only the newest page was read: if the oldest of it is still inside the window there may be more.
  const failedCut =
    failed.data != null &&
    failed.data.total > failed.data.items.length &&
    failed.data.items.length > 0 &&
    Date.parse(failed.data.items[failed.data.items.length - 1]?.failedAt ?? '') >=
      Date.parse(range.from);
  const waiting = deposits.data ?? [];
  const waitingAmount = waiting.reduce((n, s) => n + s.depositedAmount, 0);
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

      {mayLoad && (
        <WidgetCard
          title={t('insight.couriers.loadTitle')}
          source={load}
          isEmpty={() => loadRows.length === 0}
          emptyText={t('insight.couriers.loadEmpty')}
          detailHref="/dashboard/tracking"
        >
          {() => (
            <div className="flex flex-col gap-2">
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {loadRows.map(([courierId, n]) => (
                  <li key={courierId} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">
                      {mayTeam || mayPay ? nameOf(courierId) : courierId.slice(0, 6)}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {t('insight.couriers.loadLine', { n })}
                    </span>
                  </li>
                ))}
              </ul>
              {loadTruncated && load.data && (
                <p className="text-[11px] text-muted">
                  {t('insight.couriers.loadMore', {
                    shown: load.data.items.length,
                    total: load.data.total,
                  })}
                </p>
              )}
            </div>
          )}
        </WidgetCard>
      )}

      {mayLoad && (
        <WidgetCard
          title={t('insight.couriers.failedTitle')}
          source={failed}
          isEmpty={() => failedInRange.length === 0}
          emptyText={t('insight.couriers.failedEmpty')}
          detailHref="/dashboard/tracking"
        >
          {() => (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-sm font-semibold">
                {t('insight.couriers.failedCount', { n: failedInRange.length })}
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {reasons.map((r) => (
                  <li key={r.label} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {r.label || t('insight.couriers.failedNoReason')}
                    </span>
                    <span className="shrink-0 tabular-nums">{r.n}</span>
                  </li>
                ))}
              </ul>
              {failedCut && (
                <p className="text-[11px] text-muted">
                  {t('insight.couriers.failedMore', { shown: failed.data?.items.length ?? 0 })}
                </p>
              )}
              <p className="text-[11px] text-muted">{t('insight.couriers.failedNote')}</p>
            </div>
          )}
        </WidgetCard>
      )}

      {mayPay && depotId != null && !heldCash.forbidden && (
        <WidgetCard
          title={t('insight.couriers.heldTitle')}
          source={heldCash}
          // An unreadable second half is not "nothing held": keep the card so it can say so.
          isEmpty={(d) => d.couriers.length === 0 && d.failedCashSource === 'ok'}
          emptyText={t('insight.couriers.heldEmpty')}
          detailHref="/dashboard/settlements"
        >
          {(d) => (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-sm font-bold tabular-nums">
                {t('insight.couriers.heldTotal', {
                  amount: formatIDR(d.amountIdr),
                  n: d.deliveries,
                })}
              </p>
              {d.failedCashIdr > 0 && (
                <p className="m-0 text-xs text-muted">
                  {t('insight.couriers.heldFailed', { amount: formatIDR(d.failedCashIdr) })}
                </p>
              )}
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {d.couriers.map((c) => (
                  <li key={c.driverId} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">
                      {nameOf(c.driverId)}
                      {c.failedCashIdr > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted">
                          {t('insight.couriers.heldCourierFailed', {
                            amount: formatIDR(c.failedCashIdr),
                          })}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatIDR(c.amountIdr)}
                      <span className="ml-2 text-xs text-muted">
                        {t('insight.couriers.heldAge', { days: daysSince(c.oldestDeliveredAt) })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {d.failedCashSource === 'unavailable' && (
                <p role="status" className="text-[11px] text-muted">
                  {t('insight.couriers.heldUnavailable')}
                </p>
              )}
              <p className="text-[11px] text-muted">{t('insight.couriers.heldNote')}</p>
            </div>
          )}
        </WidgetCard>
      )}

      {mayPay && depotId != null && !deposits.forbidden && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiCard
            label={t('insight.couriers.waiting')}
            value={deposits.data ? String(waiting.length) : dash}
            hint={deposits.data ? formatIDR(waitingAmount) : undefined}
            definition={t('insight.couriers.waitingDef')}
            tone={waiting.length > 0 ? 'danger' : undefined}
            goodWhen="down"
          />
          {!disputed.forbidden && (
            <KpiCard
              label={t('insight.couriers.disputed')}
              value={disputed.data ? String(disputed.data.length) : dash}
              definition={t('insight.couriers.disputedDef')}
              tone={(disputed.data?.length ?? 0) > 0 ? 'danger' : undefined}
              goodWhen="down"
            />
          )}
        </section>
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
