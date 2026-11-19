'use client';

import { useState } from 'react';
import { ChartBar } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { ErrorState, Skeleton } from '@/components/ui';
import {
  CompareMonthPicker,
  CompareTable,
  currentMonthKey,
  monthRangeOfKey,
  type CompareRow,
} from '@/components/compare-table';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import { recentMonthsWib } from '@/lib/wib';
import type { DepotAdmin, GallonOutstanding, NetworkDashboard, NetworkPnl, Page } from '@/lib/types';



// Design 14d — compare up to 3 depots. Every metric (revenue/orders/SLA/avg-delivery/
// rating/gallon-outstanding) is real: network roll-up (rating = order-service
// rating-by-depot) + gallon rollup.
export default function HqComparePage() {
  const { t } = useT();
  const { toast } = useToast();
  // Flow 5b: one business month, picked and stated — it was the last 30 days here and the WIB
  // month at the depot, so the two comparison screens never described the same period.
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const monthLabel = recentMonthsWib(12).find((m) => m.key === monthKey)?.label ?? monthKey;
  const dash = useAsync<NetworkDashboard>(
    () => api.get(endpoints.hq.rollup(monthRangeOfKey(monthKey)), true),
    [monthKey],
  );
  // Laba bersih from the network P&L (netProfit): the same figure /hq/pnl shows for the month.
  const pnl = useAsync<NetworkPnl>(() => api.get(endpoints.dashboard.networkPnl(monthKey), true), [monthKey]);
  const depotList = useAsync<Page<DepotAdmin>>(() => api.getCached(endpoints.depots.manage({ limit: 100 }), true));
  const gallon = useAsync<GallonOutstanding[]>(() => api.get(endpoints.gallonNetwork.outstanding, true));
  const [selected, setSelected] = useState<string[]>([]);

  if (dash.loading || depotList.loading) return <Skeleton className="h-96 w-full" />;
  if (depotList.error) return <ErrorState message={depotList.error} onRetry={depotList.reload} />;
  // Every metric below falls back to 0 when the performance read is missing, and this screen
  // then names a winner out of three depots it knows nothing about.
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;

  const depots = depotList.data?.items ?? [];
  const perf = new Map((dash.data?.depots ?? []).map((d) => [d.depotId, d]));
  const outstanding = new Map((gallon.data ?? []).map((g) => [g.depotId, g.outstanding]));

  function toggle(id: string) {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 3) {
        toast(t('hq.compare.maxReached'), 'info');
        return cur;
      }
      return [...cur, id];
    });
  }

  const profitBy = new Map(
    (pnl.loading || pnl.error ? [] : (pnl.data?.depots ?? [])).map((r) => [r.depotId, r.netProfitIdr]),
  );
  const row = (key: string, higherIsBetter: boolean, value: CompareRow['value'], format: CompareRow['format']): CompareRow => ({
    key,
    label: t(`hq.compare.rows.${key}`),
    higherIsBetter,
    value,
    format,
  });
  const metrics: CompareRow[] = [
    row('revenue', true, (id) => perf.get(id)?.revenue ?? 0, formatIDR),
    row('orders', true, (id) => perf.get(id)?.orderCount ?? 0, (n) => String(n)),
    row('profit', true, (id) => profitBy.get(id) ?? null, formatIDR),
    row('sla', true, (id) => perf.get(id)?.slaRate ?? null, (n) => `${Math.round(n * 100)}%`),
    row('avgDelivery', false, (id) => perf.get(id)?.medianMinutes ?? perf.get(id)?.avgMinutes ?? null, (n) => t('hq.compare.minutes', { n })),
    row('rating', true, (id) => perf.get(id)?.rating ?? null, (n) => n.toFixed(1)),
    // Not a period figure: empties out right now, whatever month is picked (the label says so).
    row('gallonReturn', false, (id) => outstanding.get(id) ?? null, (n) => String(n)),
  ];

  const chosen = selected.map((id) => depots.find((d) => d.id === id)).filter((d): d is DepotAdmin => !!d);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HqPageHeader icon={ChartBar} title={t('hq.compare.title')} subtitle={t('hq.compare.subtitle', { month: monthLabel })} />
        <CompareMonthPicker value={monthKey} onChange={setMonthKey} label={t('hq.compare.monthLabel')} />
      </div>

      {/* Depot picker */}
      <div className="flex flex-wrap gap-2">
        {depots.map((d) => {
          const on = selected.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              aria-pressed={on}
              className={`min-h-11 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
              }`}
            >
              {d.name}
            </button>
          );
        })}
      </div>

      {chosen.length < 2 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.compare.pickPrompt')}</p>
      ) : (
        <CompareTable
          columns={chosen.map((d) => ({ id: d.id, name: d.name }))}
          rows={metrics}
          metricLabel=""
          bestLabel={t('hq.compare.best')}
        />
      )}
    </div>
  );
}
