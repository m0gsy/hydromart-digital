'use client';

import { useMemo, useState } from 'react';
import { Export } from '@phosphor-icons/react';

import { Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import type { ExportRow } from '@/lib/hq/stubs';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  DepotAdmin,
  ExecutiveDashboard,
  Page,
  RevenueByProduct,
  UnsettledMethodBucket,
} from '@/lib/types';

type RangeKey = 'd7' | 'd30' | 'quarter' | 'custom';
type GroupKey = 'depot' | 'product' | 'method';
type FormatKey = 'xlsx' | 'csv' | 'pdf';

const RANGE_DAYS: Record<Exclude<RangeKey, 'custom'>, number> = { d7: 7, d30: 30, quarter: 90 };
const CHIP =
  'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/** yyyy-mm-dd for `n` days ago / today — client-only, no module-scope Date. */
function isoDay(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// Design 10a — Ekspor laporan pendapatan. All three groupings are real: depot (executive
// topDepots joined to names), produk (order-service revenue-by-product), metode
// (payment-service collected-by-method). The export job itself has no endpoint → toast.
export default function HqReportsExportPage() {
  const { t } = useT();
  const { toast } = useToast();

  const [rangeKey, setRangeKey] = useState<RangeKey>('d30');
  const initial = useMemo(() => ({ from: isoDay(30), to: isoDay(0) }), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [group, setGroup] = useState<GroupKey>('depot');
  const [format, setFormat] = useState<FormatKey>('xlsx');

  function pickRange(key: RangeKey) {
    setRangeKey(key);
    if (key !== 'custom') {
      setFrom(isoDay(RANGE_DAYS[key]));
      setTo(isoDay(0));
    }
  }

  // Guard against a cleared native date input (Invalid Date → toISOString throws).
  const safeIso = (day: string, endOfDay = false): string => {
    const d = new Date(endOfDay ? `${day}T23:59:59` : day);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  };
  const fromIso = safeIso(from);
  const toIso = safeIso(to, true);

  const depots = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const dash = useAsync<ExecutiveDashboard>(
    () => api.get(endpoints.dashboard.executive({ from: fromIso, to: toIso }), true),
    [fromIso, toIso],
  );
  // Product grouping: order-service revenue-by-product. Method grouping: payment-service
  // collected (PAID) revenue by method. Both real; fetched on the active window.
  const byProduct = useAsync<RevenueByProduct>(
    () => api.get(endpoints.reports.revenueByCategory({ from: fromIso, to: toIso, limit: 50 }), true),
    [fromIso, toIso],
  );
  const byMethod = useAsync<UnsettledMethodBucket[]>(
    () => api.get(endpoints.payments.revenueByMethod({ from: fromIso, to: toIso }), true),
    [fromIso, toIso],
  );

  // Real rows for the "depot" grouping: join executive topDepots to depot names.
  const depotRows: ExportRow[] = (() => {
    const names = new Map((depots.data?.items ?? []).map((d) => [d.id, d.name]));
    return (dash.data?.topDepots?.items ?? []).map((r) => ({
      label: names.get(r.depotId) ?? r.depotId,
      orders: r.orderCount,
      revenue: r.revenue,
    }));
  })();
  const productRows: ExportRow[] = (byProduct.data?.items ?? []).map((r) => ({
    label: r.productName,
    orders: r.orderCount,
    revenue: r.revenue,
  }));
  const methodRows: ExportRow[] = (byMethod.data ?? []).map((r) => ({
    label: t(`hq.payments.unsettled.method.${r.method}`),
    orders: r.count,
    revenue: r.amount,
  }));

  const isDepot = group === 'depot';
  const active = group === 'depot' ? dash : group === 'product' ? byProduct : byMethod;
  const rows: ExportRow[] = isDepot ? depotRows : group === 'product' ? productRows : methodRows;

  function runExport() {
    // STUB: no report-export job endpoint — Milestone D.
    toast(t('hq.reportsExport.scheduled'), 'success');
  }

  const RANGES: RangeKey[] = ['d7', 'd30', 'quarter', 'custom'];
  const GROUPS: GroupKey[] = ['depot', 'product', 'method'];
  const FORMATS: FormatKey[] = ['xlsx', 'csv', 'pdf'];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Export size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.reportsExport.title')}</h1>
          <p className="text-sm text-muted">{t('hq.reportsExport.subtitle')}</p>
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        {/* Range chips + custom dates */}
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => pickRange(r)}
              aria-pressed={rangeKey === r}
              className={`${CHIP} ${rangeKey === r ? 'bg-brand-600 text-on-brand' : 'surface-elevated border border-app text-muted hover:bg-brand-50'}`}
            >
              {t(`hq.reportsExport.ranges.${r}`)}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('hq.reportsExport.from')}
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setRangeKey('custom');
              }}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('hq.reportsExport.to')}
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setRangeKey('custom');
              }}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
            />
          </label>
        </div>

        {/* Group by */}
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('hq.reportsExport.groupBy')}</p>
          <div className="flex flex-wrap gap-2">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                aria-pressed={group === g}
                className={`${CHIP} inline-flex items-center gap-1.5 ${group === g ? 'bg-brand-600 text-on-brand' : 'surface-elevated border border-app text-muted hover:bg-brand-50'}`}
              >
                {t(`hq.reportsExport.group.${g}`)}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Live preview */}
      <Card className="flex flex-col p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          {t('hq.reportsExport.preview')}
        </h2>
        {active.loading || (isDepot && depots.loading) ? (
          <Skeleton className="h-40 w-full" />
        ) : active.error ? (
          <ErrorState message={active.error} onRetry={active.reload} />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('hq.reportsExport.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead>
                <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">{t('hq.reportsExport.cols.label')}</th>
                  <th className="pb-2 text-right font-medium">{t('hq.reportsExport.cols.orders')}</th>
                  <th className="pb-2 text-right font-medium">{t('hq.reportsExport.cols.revenue')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className="py-2.5 font-medium">{r.label}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.orders.toLocaleString('id-ID')}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      <Money amount={r.revenue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Format + export */}
      <Card className="flex flex-wrap items-end justify-between gap-4 p-5">
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('hq.reportsExport.format')}</p>
          <div className="flex overflow-hidden rounded-lg border border-app text-sm font-semibold">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                aria-pressed={format === f}
                className={`px-4 py-2 uppercase transition-colors ${format === f ? 'bg-brand-600 text-on-brand' : 'text-muted hover:bg-brand-50'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={runExport}>
          <Export size={16} weight="bold" />
          {t('hq.reportsExport.export')}
        </Button>
      </Card>
    </div>
  );
}
