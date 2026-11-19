'use client';

import { useState } from 'react';

import { Lightbulb, Lock, ChartBar } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canUseManagerConsole } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { recentMonthsWib } from '@/lib/wib';
import {
  CompareMonthPicker,
  CompareTable,
  currentMonthKey,
  monthRangeOfKey,
  type CompareRow,
} from '@/components/compare-table';
import { useT } from '@/lib/locale-context';
import type { NetworkPnl, ReportDepotCompare } from '@/lib/types';

function CompareBody() {
  const { t } = useT();
  const { depots, scopedId } = useDepot();
  const depotIds = depots.map((d) => d.id);
  // Flow 5b: one business month, picked and stated — the same period head office compares.
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const monthLabel = recentMonthsWib(12).find((m) => m.key === monthKey)?.label ?? monthKey;
  const report = useAsync<ReportDepotCompare | null>(
    () =>
      depotIds.length
        ? api.get(endpoints.reports.depotCompare(depotIds, monthRangeOfKey(monthKey)), true)
        : Promise.resolve(null),
    [depotIds.join(','), monthKey],
  );
  // Laba bersih is the network P&L's row for each depot (netProfit, the one formula), not
  // order-service's cash figure — that one is "arus kas bersih" on the monthly review.
  const pnl = useAsync<NetworkPnl>(
    () => api.get(endpoints.dashboard.networkPnl(monthKey), true),
    [monthKey],
  );

  if (depots.length === 0) {
    return (
      <CenterState title={t('opsFix.compare.noDepots')} icon={<ChartBar size={40} weight="fill" />}>
        {t('opsFix.compare.noDepotsBody')}
      </CenterState>
    );
  }

  const byDepot = new Map((report.data?.depots ?? []).map((r) => [r.depotId, r]));
  // Stale data from the previous month (useAsync keeps it while reloading or after a failure)
  // must never sit under this month's name.
  const profitBy = new Map(
    (pnl.loading || pnl.error ? [] : (pnl.data?.depots ?? [])).map((r) => [r.depotId, r.netProfitIdr]),
  );
  const rows: CompareRow[] = [
    {
      key: 'orders',
      label: t('opsFix.compare.mOrders'),
      higherIsBetter: true,
      value: (id) => byDepot.get(id)?.orders ?? 0,
      format: (n) => n.toLocaleString('id-ID'),
    },
    {
      key: 'revenue',
      label: t('opsFix.compare.mRevenue'),
      higherIsBetter: true,
      value: (id) => byDepot.get(id)?.revenueIdr ?? 0,
      format: formatIDR,
    },
    {
      key: 'sla',
      label: t('opsFix.compare.mSla'),
      higherIsBetter: true,
      value: (id) => byDepot.get(id)?.slaPct ?? null,
      format: (n) => `${n}%`,
    },
    {
      key: 'wastage',
      label: t('opsFix.compare.mWastage'),
      higherIsBetter: false,
      value: (id) => byDepot.get(id)?.wastageGallons ?? null,
      format: (n) => n.toLocaleString('id-ID'),
    },
    {
      key: 'profit',
      label: t('opsFix.compare.mProfit'),
      higherIsBetter: true,
      value: (id) => profitBy.get(id) ?? null,
      format: formatIDR,
    },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChartBar size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('opsFix.compare.title')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {t('opsFix.compare.subtitle', { month: monthLabel })}
            </p>
          </div>
        </div>
        <CompareMonthPicker value={monthKey} onChange={setMonthKey} label={t('opsFix.compare.monthLabel')} />
      </div>

      {report.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : (
        <CompareTable
          columns={depots.map((d) => ({ id: d.id, name: d.name, sub: d.code, highlight: d.id === scopedId }))}
          rows={rows}
          metricLabel={t('opsFix.compare.colMetric')}
          bestLabel={t('hq.compare.best')}
        />
      )}

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Lightbulb size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <div>
          <p className="font-semibold text-brand-800">{t('opsFix.compare.insight')}</p>
          <p className="text-[12.5px] text-brand-800/80">{t('opsFix.compare.insightBody')}</p>
        </div>
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canUseManagerConsole(customer?.role)) {
    return (
      <CenterState title={t('opsFix.compare.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.compare.gateBody')}
      </CenterState>
    );
  }
  return <CompareBody />;
}

export default function ComparePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
