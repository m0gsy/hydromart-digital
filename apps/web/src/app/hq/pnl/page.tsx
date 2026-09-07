'use client';

import { useMemo, useState } from 'react';
import { ChartPieSlice, WarningCircle } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { NetworkPnl, NetworkPnlDepotRow } from '@/lib/types';
import { useAsync } from '@/lib/use-async';
import { BUSINESS_TZ, wibParts } from '@/lib/wib';

/*
 * CA-2-59 — the network profit-and-loss head office never had.
 *
 * `/hq` reported REVENUE per depot and no cost term at all, so the only question head
 * office could answer was which depot sold the most — not which one earned anything.
 *
 * Owner decision 2026-09-04: build it from what is already recorded, and from nothing else.
 * Rent and electricity are deliberately absent, because nothing records them and a P&L that
 * estimates a cost is a P&L nobody can dispute a line of. The report says so on its face.
 */
const MONTH_LABEL_FMT = new Intl.DateTimeFormat('id-ID', {
  timeZone: BUSINESS_TZ,
  month: 'long',
  year: 'numeric',
});

/** The last `count` months, newest first, as business-timezone `YYYY-MM` keys. */
function recentMonths(count: number): { key: string; label: string }[] {
  const { year, month } = wibParts();
  return Array.from({ length: count }, (_, i) => {
    // UTC arithmetic on parts already read in the business zone — no second timezone hop,
    // and month overflow is handled by Date itself. Same shape as the depot P&L screen.
    const at = new Date(Date.UTC(year, month - 1 - i, 1));
    return {
      key: `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`,
      label: MONTH_LABEL_FMT.format(at),
    };
  });
}

/*
 * A dash, not "Rp 0".
 *
 * This is the whole honesty of the screen in one function: a cost that could not be read is
 * unknown, and rendering it as zero would show head office a profit that is too high by
 * exactly the amount nobody could measure.
 */
const money = (value: number | null): string => (value === null ? '—' : formatIDR(value));

const COST_KEYS = [
  'cogsIdr',
  'payrollIdr',
  'courierCommissionIdr',
  'expenseClaimIdr',
  'refundIdr',
] as const;

export default function HqPnlPage() {
  const { t } = useT();
  const months = useMemo(() => recentMonths(12), []);
  const [monthKey, setMonthKey] = useState(months[0]!.key);
  const monthLabel = months.find((m) => m.key === monthKey)?.label ?? monthKey;
  const report = useAsync<NetworkPnl>(
    () => api.get(endpoints.dashboard.networkPnl(monthKey), true),
    [monthKey],
  );

  const unreadable = report.data
    ? Object.entries(report.data.sources)
        .filter(([, status]) => status !== 'ok')
        .map(([source]) => t(`hq.pnl.source.${source}`))
    : [];

  return (
    <div className="flex flex-col gap-5">
      <HqPageHeader
        icon={ChartPieSlice}
        title={t('hq.pnl.title')}
        subtitle={t('hq.pnl.subtitle', { month: monthLabel })}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="brand">{t('hq.pnl.operational')}</Badge>
            <select
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              aria-label={t('hq.pnl.monthLabel')}
              className="surface-elevated rounded-lg border border-app px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {report.loading ? (
        <Skeleton className="h-96 w-full" />
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <>
          {unreadable.length > 0 && (
            <Card className="flex items-start gap-2.5 border-[color:var(--warning)] p-4">
              <WarningCircle
                size={18}
                weight="fill"
                className="mt-0.5 flex-shrink-0 text-[color:var(--warning)]"
              />
              <p className="text-sm">
                {t('hq.pnl.unreadable', { sources: unreadable.join(', ') })}
              </p>
            </Card>
          )}

          <PnlTable data={report.data} />

          <Card className="p-4 text-xs leading-relaxed text-muted">{report.data.disclaimer}</Card>
        </>
      ) : null}
    </div>
  );
}

function PnlTable({ data }: { data: NetworkPnl }) {
  const { t } = useT();
  const cell = (value: number | null, negative = false) => (
    <td
      className={`px-3 py-2 text-right tabular-nums ${
        value === null ? 'text-muted' : negative && value > 0 ? 'text-[color:var(--danger)]' : ''
      }`}
    >
      {money(value)}
    </td>
  );

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">{t('hq.pnl.colDepot')}</th>
            <th className="px-3 py-2 text-right">{t('hq.pnl.colRevenue')}</th>
            <th className="px-3 py-2 text-right">{t('hq.pnl.colCogs')}</th>
            <th className="px-3 py-2 text-right">{t('hq.pnl.colPayroll')}</th>
            <th className="px-3 py-2 text-right">{t('hq.pnl.colCommission')}</th>
            <th className="px-3 py-2 text-right">{t('hq.pnl.colClaims')}</th>
            <th className="px-3 py-2 text-right">{t('hq.pnl.colRefunds')}</th>
            <th className="px-3 py-2 text-right">{t('hq.pnl.colNet')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {data.depots.map((row: NetworkPnlDepotRow) => (
            <tr key={row.depotId}>
              <td className="px-3 py-2">
                <span className="font-semibold">{row.name}</span>
                <span className="ml-2 text-xs text-muted">{row.code}</span>
                {!row.active && (
                  <span className="ml-2 text-xs text-muted">{t('hq.pnl.inactive')}</span>
                )}
              </td>
              {cell(row.revenueIdr)}
              {COST_KEYS.map((key) => (
                <span key={key} className="contents">
                  {cell(row[key], true)}
                </span>
              ))}
              <td
                className={`px-3 py-2 text-right font-bold tabular-nums ${
                  row.netProfitIdr === null
                    ? 'text-muted'
                    : row.netProfitIdr < 0
                      ? 'text-[color:var(--danger)]'
                      : ''
                }`}
              >
                {money(row.netProfitIdr)}
              </td>
            </tr>
          ))}
          {data.depots.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-6 text-center text-muted">
                {t('hq.pnl.empty')}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot className="border-t-2 border-app font-bold">
          <tr>
            <td className="px-3 py-2">{t('hq.pnl.total')}</td>
            {cell(data.totals.revenueIdr)}
            {COST_KEYS.map((key) => (
              <span key={key} className="contents">
                {cell(data.totals[key], true)}
              </span>
            ))}
            <td
              className={`px-3 py-2 text-right tabular-nums ${
                data.totals.netProfitIdr !== null && data.totals.netProfitIdr < 0
                  ? 'text-[color:var(--danger)]'
                  : ''
              }`}
            >
              {money(data.totals.netProfitIdr)}
            </td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}
