'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChartLineUp, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Field, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { trendLabel } from '@/lib/forecast';
import { canViewForecast } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Depot, ForecastItem, Page } from '@/lib/types';

// Depot-service returns the full record; we only need these fields for the picker.
type DepotOption = Depot & Record<string, unknown>;

const HORIZON_OPTIONS = [7, 14, 30];
const HISTORY_OPTIONS = [30, 60, 90];

function ForecastBody() {
  const [depotId, setDepotId] = useState('');
  const [horizonDays, setHorizonDays] = useState(7);
  const [historyDays, setHistoryDays] = useState(30);

  const depots = useAsync<Page<DepotOption>>(() => api.get(endpoints.depots.browse({ limit: 100 }), true));
  const options = depots.data?.items ?? [];

  // Default to the first depot once the list loads (keyed on stable loaded data).
  useEffect(() => {
    const first = depots.data?.items?.[0];
    if (!depotId && first) setDepotId(first.id);
  }, [depotId, depots.data]);

  // Server (forecast-service) enforces PLANNING_ROLES on this call; the gate below is UX only.
  const rows = useAsync<ForecastItem[]>(
    () =>
      depotId
        ? api.get(endpoints.forecast.depot(depotId, { historyDays, horizonDays, limit: 50 }), true)
        : Promise.resolve([]),
    [depotId, historyDays, horizonDays],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChartLineUp size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Demand forecast</h1>
        </div>
        <Link href="/dashboard/inventory" className="text-sm font-semibold text-brand-700 hover:underline">
          Inventory →
        </Link>
      </div>

      {depots.loading ? (
        <Skeleton className="h-11 w-full" />
      ) : depots.error ? (
        <ErrorState message={depots.error} onRetry={depots.reload} />
      ) : options.length === 0 ? (
        <CenterState title="No depots" icon={<ChartLineUp size={40} weight="fill" />}>
          No depots are configured yet.
        </CenterState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Depot" htmlFor="depot">
              <select
                id="depot"
                value={depotId}
                onChange={(e) => setDepotId(e.target.value)}
                className="surface-elevated w-full min-w-56 rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
              >
                {options.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.city}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Forecast horizon" htmlFor="horizon">
              <select
                id="horizon"
                value={horizonDays}
                onChange={(e) => setHorizonDays(Number(e.target.value))}
                className="surface-elevated rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
              >
                {HORIZON_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    Next {d} days
                  </option>
                ))}
              </select>
            </Field>
            <Field label="History window" htmlFor="history">
              <select
                id="history"
                value={historyDays}
                onChange={(e) => setHistoryDays(Number(e.target.value))}
                className="surface-elevated rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
              >
                {HISTORY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    Last {d} days
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {rows.loading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.error ? (
            <ErrorState message={rows.error} onRetry={rows.reload} />
          ) : !rows.data || rows.data.length === 0 ? (
            <CenterState title="No forecast yet" icon={<ChartLineUp size={40} weight="fill" />}>
              No demand history for this depot yet.
            </CenterState>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 text-right font-medium">Avg / day</th>
                    <th className="px-4 py-3 font-medium">Trend</th>
                    <th className="px-4 py-3 text-right font-medium">Predicted ({horizonDays}d)</th>
                    <th className="px-4 py-3 text-right font-medium">Reorder</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data.map((r) => (
                    <tr key={r.productId} className="border-b border-app last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium">{r.name ?? r.sku ?? r.productId}</span>
                        {r.unit && <span className="ml-1 text-xs text-muted">/ {r.unit}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.avgDaily.toLocaleString('id-ID')}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{trendLabel(r.trendSlope)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {r.predictedTotal.toLocaleString('id-ID')}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.reorderSuggestion.toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewForecast(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        Forecasting is staff-only — available to depot and planning staff.
      </CenterState>
    );
  }
  return <ForecastBody />;
}

export default function ForecastPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
