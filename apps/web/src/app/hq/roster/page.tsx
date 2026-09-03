'use client';

import { Truck } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { fetchAllDepots } from '@/lib/all-depots';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { useT } from '@/lib/locale-context';
import {
  ACTIVE_DELIVERY_STATUSES,
  deriveRoster,
  type CourierShift,
  type RosterRow,
} from '@/lib/roster';
import { useAsync } from '@/lib/use-async';
import type { Customer, Delivery, Page } from '@/lib/types';

interface RosterView extends RosterRow {
  depotLabel: string;
}

// Design 16c — courier roster. Joins the courier directory with live deliveries and today's
// shifts: load = active deliveries, depot = the courier's own (their working depot shown
// alongside when it differs), state = why they can or cannot take a delivery right now.
export default function HqRosterPage() {
  const { t } = useT();

  const data = useAsync<RosterView[]>(async () => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [drivers, deliveries, depotList, shifts] = await Promise.all([
      api.get<Customer[]>(endpoints.auth.drivers, true),
      /*
       * Both halves of this, because each was a different way of miscounting.
       *
       * Unfiltered, it asked for the 100 most recently ASSIGNED deliveries of any status —
       * and delivery-service orders by `assignedAt desc`, so on a busy day those 100 are
       * mostly rows already DELIVERED. A courier still holding a delivery assigned
       * yesterday fell off the page, and the roster read them as carrying nothing.
       *
       * CA-2-26 / CA-2-41: and the count itself stopped at one page of 100. Every delivery
       * past it was invisible, so a fully loaded courier could read as "tersedia" on the
       * screen HQ uses to decide who takes the next job. A wrong load is worse than a short
       * list — it does not look wrong, it looks like spare capacity.
       *
       * The status filter is what makes the number mean "in flight"; paging to the end is
       * what makes it complete. Neither alone counts right.
       */
      fetchAllPages<Delivery>(({ page, limit }) =>
        api.get<Page<Delivery>>(
          endpoints.deliveries.list({ statuses: ACTIVE_DELIVERY_STATUSES, page, limit }),
          true,
        ),
      ),
      // And the depot names beside it: past the hundredth depot every courier there read
      // as "depot tidak diketahui".
      fetchAllDepots(),
      // Not getCached: who is on shift right now is the one read here that goes stale in
      // seconds, and a 60s cache would show a courier who has already clocked off.
      api.get<CourierShift[]>(endpoints.deliveries.shiftsOnDuty(since.toISOString()), true),
    ]);
    const depotName = new Map(depotList.map((d) => [d.id, d.name]));
    const named = (id: string | null): string | null => (id ? (depotName.get(id) ?? null) : null);

    return deriveRoster(drivers, deliveries, shifts).map((row) => {
      const home = named(row.depotId);
      const away = named(row.activeDepotId);
      return {
        ...row,
        depotLabel: away
          ? t('hq.roster.workingAway', { home: home ?? t('hq.roster.unknownDepot'), away })
          : (home ?? t('hq.roster.unknownDepot')),
      };
    });
  });

  const rows = data.data ?? [];
  const tone = {
    delivering: 'brand',
    available: 'success',
    resting: 'neutral',
    offshift: 'warning',
  } as const;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Truck} title={t('hq.roster.title')} subtitle={t('hq.roster.subtitle')} />

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.roster.empty')}</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[440px] text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">{t('hq.roster.courier')}</th>
                <th className="px-4 py-3 font-medium">{t('hq.roster.depot')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('hq.roster.load')}</th>
                <th className="px-4 py-3 font-medium">{t('hq.roster.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {rows.map((r) => (
                <tr key={r.driver.id}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.driver.fullName || r.driver.phone}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{r.depotLabel}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t('hq.roster.loadCount', { n: r.load })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tone[r.state]}>{t(`hq.roster.${r.state}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
