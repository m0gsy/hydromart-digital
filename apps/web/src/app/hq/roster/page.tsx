'use client';

import { Truck } from '@phosphor-icons/react';

import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { deriveRoster, type CourierShift, type RosterRow } from '@/lib/roster';
import { useAsync } from '@/lib/use-async';
import type { Customer, Delivery, DepotAdmin, Page } from '@/lib/types';

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
      api.get<Page<Delivery>>(endpoints.deliveries.list({ limit: 100 }), true),
      api.get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true),
      api.get<CourierShift[]>(endpoints.deliveries.shiftsOnDuty(since.toISOString()), true),
    ]);
    const depotName = new Map(depotList.items.map((d) => [d.id, d.name]));
    const named = (id: string | null): string | null => (id ? (depotName.get(id) ?? null) : null);

    return deriveRoster(drivers, deliveries.items, shifts).map((row) => {
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
      <div className="flex items-center gap-2">
        <Truck size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.roster.title')}</h1>
          <p className="text-sm text-muted">{t('hq.roster.subtitle')}</p>
        </div>
      </div>

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
