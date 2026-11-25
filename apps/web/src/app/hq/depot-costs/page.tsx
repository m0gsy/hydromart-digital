'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Buildings, UploadSimple } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { DepotFixedCostMonth } from '@/lib/types';
import { useAsync } from '@/lib/use-async';
import { BUSINESS_TZ, wibParts } from '@/lib/wib';

const MONTH_LABEL_FMT = new Intl.DateTimeFormat('id-ID', {
  timeZone: BUSINESS_TZ,
  month: 'long',
  year: 'numeric',
});

/** The last `count` months, newest first, as business-timezone `YYYY-MM` keys. */
function recentMonths(count: number): { key: string; label: string }[] {
  const { year, month } = wibParts();
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(Date.UTC(year, month - 1 - i, 1));
    return {
      key: `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`,
      label: MONTH_LABEL_FMT.format(at),
    };
  });
}

/**
 * HD-16 (D22) — what head office has entered as fixed costs, per depot and category, for one
 * month. Read-only: the numbers arrive by the spreadsheet import, and a correction is the same
 * file uploaded again. Not yet part of the depot P&L.
 */
export default function HqDepotCostsPage() {
  const { t } = useT();
  const months = useMemo(() => recentMonths(24), []);
  const [monthKey, setMonthKey] = useState(months[0]!.key);
  const monthLabel = months.find((m) => m.key === monthKey)?.label ?? monthKey;
  const report = useAsync<DepotFixedCostMonth>(
    () => api.get(endpoints.depotFixedCosts.list(monthKey), true),
    [monthKey],
  );

  return (
    <div className="flex flex-col gap-5">
      <HqPageHeader
        icon={Buildings}
        title={t('hq.depotCosts.title')}
        subtitle={t('hq.depotCosts.subtitle', { month: monthLabel })}
        action={
          <div className="flex items-center gap-2">
            <select
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              aria-label={t('hq.depotCosts.monthLabel')}
              className="surface-elevated rounded-lg border border-app px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <Link
              href="/hq/depot-costs/import"
              className="inline-flex items-center gap-1.5 rounded-lg border border-app px-3 py-2 text-sm font-medium"
            >
              <UploadSimple size={16} />
              {t('hq.depotCosts.importButton')}
            </Link>
          </div>
        }
      />

      {report.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <CostTable data={report.data} />
      ) : null}
    </div>
  );
}

function CostTable({ data }: { data: DepotFixedCostMonth }) {
  const { t } = useT();
  if (data.rows.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted">{t('hq.depotCosts.empty')}</Card>;
  }
  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">{t('hq.depotCosts.colDepot')}</th>
              <th className="px-3 py-2">{t('hq.depotCosts.colCategory')}</th>
              <th className="px-3 py-2 text-right">{t('hq.depotCosts.colAmount')}</th>
              <th className="px-3 py-2">{t('hq.depotCosts.colNote')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <span className="font-semibold">{r.depotName}</span>
                  <span className="ml-2 text-xs text-muted">{r.depotCode}</span>
                </td>
                <td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatIDR(r.amountIdr)}</td>
                <td className="px-3 py-2 text-muted">{r.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-app font-bold">
            <tr>
              <td className="px-3 py-2" colSpan={2}>
                {t('hq.depotCosts.total')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatIDR(data.totalIdr)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">{t('hq.depotCosts.colDepot')}</th>
              <th className="px-3 py-2 text-right">{t('hq.depotCosts.colDepotTotal')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {data.byDepot.map((d) => (
              <tr key={d.depotId}>
                <td className="px-3 py-2">
                  <span className="font-semibold">{d.depotName}</span>
                  <span className="ml-2 text-xs text-muted">{d.depotCode}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatIDR(d.totalIdr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
