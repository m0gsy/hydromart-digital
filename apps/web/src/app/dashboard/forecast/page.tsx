'use client';

import { useState } from 'react';
import { ChartLineUp, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Field, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { trendLabel } from '@/lib/forecast';
import { formatIDR } from '@/lib/format';
import { canViewForecast } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { ForecastItem, SalesForecast } from '@/lib/types';

const HORIZON_OPTIONS = [7, 14, 30];
const HISTORY_OPTIONS = [30, 60, 90];

/** Compact revenue-forecast card for the picked depot. */
function RevenueCard({ sales, horizonDays }: { sales: ReturnType<typeof useAsync<SalesForecast | null>>; horizonDays: number }) {
  if (sales.loading) return <Skeleton className="h-24 w-full" />;
  if (sales.error) return <ErrorState message={sales.error} onRetry={sales.reload} />;

  const data = sales.data;
  const hasHistory = data != null && data.history.some((v) => v > 0);
  if (!data || !hasHistory) {
    return (
      <Card className="p-5 text-sm text-muted">No revenue history yet for this depot.</Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-end justify-between gap-4 p-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Predicted revenue · next {horizonDays} days</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{formatIDR(data.predictedTotal)}</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Avg / day</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatIDR(Math.round(data.avgDaily))}</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Trend</p>
        <p className="mt-1 whitespace-nowrap text-lg font-semibold">{trendLabel(data.trendSlope)}</p>
      </div>
    </Card>
  );
}

function ForecastBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  const depotId = scopedId ?? '';
  const [horizonDays, setHorizonDays] = useState(7);
  const [historyDays, setHistoryDays] = useState(30);

  const scopedDepot = selected ?? depots.find((d) => d.id === depotId) ?? null;

  // Server (forecast-service) enforces PLANNING_ROLES on this call; the gate below is UX only.
  const rows = useAsync<ForecastItem[]>(
    () =>
      depotId
        ? api.get(endpoints.forecast.depot(depotId, { historyDays, horizonDays, limit: 50 }), true)
        : Promise.resolve([]),
    [depotId, historyDays, horizonDays],
  );

  const sales = useAsync<SalesForecast | null>(
    () =>
      depotId
        ? api.get(endpoints.forecast.sales({ depotId, historyDays, horizonDays }), true)
        : Promise.resolve(null),
    [depotId, historyDays, horizonDays],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ChartLineUp size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Demand forecast</h1>
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          Prediksi permintaan untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          (dari switcher). Saran restok muncul saat proyeksi menembus stok minimum.
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title="No depots" icon={<ChartLineUp size={40} weight="fill" />}>
          No depots are configured yet.
        </CenterState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
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

          <RevenueCard sales={sales} horizonDays={horizonDays} />

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
