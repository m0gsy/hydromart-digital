'use client';

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
import { useT } from '@/lib/locale-context';
import type { ReportDepotCompare, ReportDepotCompareRow } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());

// Current calendar month window [first-of-month, first-of-next-month) — matches the header.
const now = new Date();
const MONTH_FROM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
const MONTH_TO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

type CompareMetric = {
  labelKey: string;
  // null = no source for this metric (rendered as "—", never counts for the "best" highlight).
  value: (row: ReportDepotCompareRow | undefined) => number | null;
  format: (n: number) => string;
  higherIsBetter: boolean;
};

const METRICS: CompareMetric[] = [
  { labelKey: 'mOrders', value: (r) => r?.orders ?? 0, format: (n) => n.toLocaleString('id-ID'), higherIsBetter: true },
  { labelKey: 'mRevenue', value: (r) => r?.revenueIdr ?? 0, format: formatIDR, higherIsBetter: true },
  // S2: these three used to be `value: () => null` — three of five rows permanently "—",
  // which is a comparison screen nobody opens. order-service still cannot join them; it
  // asks delivery-service, depot-service and hr-service per depot instead. Null survives
  // as "—" when a source could not be read, and is never rendered as a zero.
  { labelKey: 'mSla', value: (r) => r?.slaPct ?? null, format: (n) => `${n}%`, higherIsBetter: true },
  {
    labelKey: 'mWastage',
    value: (r) => r?.wastageGallons ?? null,
    format: (n) => n.toLocaleString('id-ID'),
    higherIsBetter: false,
  },
  { labelKey: 'mProfit', value: (r) => r?.netProfitIdr ?? null, format: formatIDR, higherIsBetter: true },
];

function CompareBody() {
  const { t } = useT();
  const { depots, scopedId } = useDepot();
  const depotIds = depots.map((d) => d.id);

  const report = useAsync<ReportDepotCompare | null>(
    () =>
      depotIds.length
        ? api.get(endpoints.reports.depotCompare(depotIds, { from: MONTH_FROM, to: MONTH_TO }), true)
        : Promise.resolve(null),
    [depotIds.join(',')],
  );

  if (depots.length === 0) {
    return (
      <CenterState title={t('opsFix.compare.noDepots')} icon={<ChartBar size={40} weight="fill" />}>
        {t('opsFix.compare.noDepotsBody')}
      </CenterState>
    );
  }

  const byDepot = new Map((report.data?.depots ?? []).map((r) => [r.depotId, r]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ChartBar size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('opsFix.compare.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {t('opsFix.compare.subtitle', { month: MONTH })}
          </p>
        </div>
      </div>

      {report.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app">
                <th className="p-3 text-left font-semibold text-[color:var(--text-muted)]">{t('opsFix.compare.colMetric')}</th>
                {depots.map((d) => {
                  const active = d.id === scopedId;
                  return (
                    <th
                      key={d.id}
                      className={`p-3 text-right font-bold ${active ? 'bg-brand-50 text-brand-800' : ''}`}
                    >
                      <span className="block">{d.name}</span>
                      <span className="text-xs font-medium text-[color:var(--text-muted)]">{d.code}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const values = depots.map((d) => m.value(byDepot.get(d.id)));
                const present = values.filter((v): v is number => v !== null);
                const best =
                  present.length > 1
                    ? m.higherIsBetter
                      ? Math.max(...present)
                      : Math.min(...present)
                    : null;
                return (
                  <tr key={m.labelKey} className="border-b border-app last:border-0">
                    <td className="p-3 font-medium">{t(`opsFix.compare.${m.labelKey}`)}</td>
                    {depots.map((d, di) => {
                      const value = values[di] ?? null;
                      const active = d.id === scopedId;
                      const isBest = best !== null && value === best && depots.length > 1;
                      return (
                        <td
                          key={d.id}
                          className={`p-3 text-right tabular-nums ${active ? 'bg-brand-50' : ''} ${
                            isBest ? 'font-bold text-brand-700' : ''
                          }`}
                        >
                          {value === null ? (
                            <span className="text-[color:var(--text-muted)]">—</span>
                          ) : (
                            m.format(value)
                          )}
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

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Lightbulb size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <div>
          <p className="font-semibold text-brand-800">{t('opsFix.compare.insight')}</p>
          {/* This used to say SLA, wastage and net profit had no cross-service source and
              were dashed "until the backend is connected" — S2 connected all three. The note
              now names where each number comes from and what a "—" means. */}
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
