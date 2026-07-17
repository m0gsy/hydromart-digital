'use client';

import { useMemo, useState } from 'react';
import { ChartBar } from '@phosphor-icons/react';

import { Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, GallonOutstanding, NetworkDashboard, Page } from '@/lib/types';

function range30(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// One comparable KPI row. `higher` = a bigger value wins (for best-value highlight).
// A null value = no data for that depot (rendered as a dash, excluded from the best-of).
interface Metric {
  key: string;
  higher: boolean;
  value: (depotId: string) => number | null;
  format: (n: number) => string;
}

// Design 14d — compare up to 3 depots. Every metric (revenue/orders/SLA/avg-delivery/
// rating/gallon-outstanding) is real: network roll-up (rating = order-service
// rating-by-depot) + gallon rollup.
export default function HqComparePage() {
  const { t } = useT();
  const { toast } = useToast();
  const range = useMemo(range30, []);
  const dash = useAsync<NetworkDashboard>(() => api.get(endpoints.hq.rollup(range), true));
  const depotList = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const gallon = useAsync<GallonOutstanding[]>(() => api.get(endpoints.gallonNetwork.outstanding, true));
  const [selected, setSelected] = useState<string[]>([]);

  if (dash.loading || depotList.loading) return <Skeleton className="h-96 w-full" />;
  if (depotList.error) return <ErrorState message={depotList.error} onRetry={depotList.reload} />;

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

  const metrics: Metric[] = [
    { key: 'revenue', higher: true, value: (id) => perf.get(id)?.revenue ?? 0, format: formatIDR },
    { key: 'orders', higher: true, value: (id) => perf.get(id)?.orderCount ?? 0, format: (n) => String(n) },
    { key: 'sla', higher: true, value: (id) => perf.get(id)?.slaRate ?? null, format: (n) => `${Math.round(n * 100)}%` },
    { key: 'avgDelivery', higher: false, value: (id) => perf.get(id)?.avgMinutes ?? null, format: (n) => t('hq.compare.minutes', { n }) },
    { key: 'rating', higher: true, value: (id) => perf.get(id)?.rating ?? null, format: (n) => n.toFixed(1) },
    { key: 'gallonReturn', higher: false, value: (id) => outstanding.get(id) ?? null, format: (n) => String(n) },
  ];

  const chosen = selected.map((id) => depots.find((d) => d.id === id)).filter((d): d is DepotAdmin => !!d);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ChartBar size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.compare.title')}</h1>
          <p className="text-sm text-muted">{t('hq.compare.subtitle')}</p>
        </div>
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
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
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
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[440px] text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium" />
                {chosen.map((d) => (
                  <th key={d.id} className="px-4 py-3 text-right font-medium">
                    {d.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {metrics.map((m) => {
                const present = chosen
                  .map((d) => m.value(d.id))
                  .filter((v): v is number => v != null);
                const best = present.length
                  ? m.higher
                    ? Math.max(...present)
                    : Math.min(...present)
                  : null;
                return (
                  <tr key={m.key}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        {t(`hq.compare.rows.${m.key}`)}
                      </span>
                    </td>
                    {chosen.map((d) => {
                      const v = m.value(d.id);
                      const isBest = v != null && best != null && v === best;
                      return (
                        <td
                          key={d.id}
                          className={`px-4 py-3 text-right tabular-nums ${isBest ? 'font-bold text-brand-700' : ''}`}
                        >
                          {v == null ? <span className="text-muted">{t('hq.common.dash')}</span> : m.format(v)}
                          {isBest && <span className="ml-1.5 text-[10px] font-bold uppercase text-brand-600">{t('hq.compare.best')}</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
