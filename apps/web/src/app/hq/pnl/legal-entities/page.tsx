'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bank } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { LegalEntityPnl } from '@/lib/types';
import { useAsync } from '@/lib/use-async';
import { BUSINESS_TZ, wibParts } from '@/lib/wib';

const MONTH_LABEL_FMT = new Intl.DateTimeFormat('id-ID', { timeZone: BUSINESS_TZ, month: 'long', year: 'numeric' });

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

// A dash, never "Rp 0": null is a figure nobody could read (or, for fixed costs, nothing entered).
const money = (v: number | null | undefined): string => (v == null ? '—' : formatIDR(v));

const LINES = [
  ['revenueIdr', 'colRevenue'],
  ['cogsIdr', 'colCogs'],
  ['payrollIdr', 'colPayroll'],
  ['courierCommissionIdr', 'colCommission'],
  ['expenseClaimIdr', 'colClaims'],
  ['refundIdr', 'colRefunds'],
  ['fixedCostIdr', 'colFixed'],
  ['netProfitIdr', 'colNet'],
] as const;

/**
 * HD-16 PR-B (D22, D25) — the monthly P&L of each legal entity. The numbers are the network P&L's own
 * rows, grouped by the entity that held the depot the WHOLE month; a depot that changed entity inside
 * the month is in none of them and is named at the bottom.
 */
export default function HqLegalEntityPnlPage() {
  const { t } = useT();
  const months = useMemo(() => recentMonths(12), []);
  const [monthKey, setMonthKey] = useState(months[0]!.key);
  const monthLabel = months.find((m) => m.key === monthKey)?.label ?? monthKey;
  const report = useAsync<LegalEntityPnl>(
    () => api.get(endpoints.dashboard.legalEntityPnl(monthKey), true),
    [monthKey],
  );

  return (
    <div className="flex flex-col gap-5">
      <HqPageHeader
        icon={Bank}
        title={t('hq.pnl.entities.title')}
        subtitle={t('hq.pnl.subtitle', { month: monthLabel })}
        action={
          <div className="flex items-center gap-2">
            <Link href="/hq/pnl" className="rounded-lg border border-app px-3 py-2 text-sm font-medium">
              {t('hq.pnl.entities.back')}
            </Link>
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
        <Skeleton className="h-64 w-full" />
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <Body data={report.data} />
      ) : null}
    </div>
  );
}

function Body({ data }: { data: LegalEntityPnl }) {
  const { t } = useT();
  const payHidden = data.payVisible === false;
  const lines = LINES.filter(([key]) => !payHidden || (key !== 'payrollIdr' && key !== 'fixedCostIdr' && key !== 'netProfitIdr'));
  if (data.sources.legalEntities === 'unavailable') {
    return <Card className="p-4 text-sm text-[color:var(--warning)]">{t('hq.pnl.entities.unavailable')}</Card>;
  }
  return (
    <>
      {data.entities.length === 0 && <Card className="p-6 text-center text-sm text-muted">{t('hq.pnl.entities.empty')}</Card>}
      {data.entities.map((e) => (
        <Card key={e.legalEntityId ?? 'none'} className="overflow-x-auto p-0">
          <div className="border-b border-app px-3 py-2">
            <h2 className="font-semibold">{e.name}</h2>
            <p className="text-xs text-muted">{e.depots.map((d) => d.name).join(', ')}</p>
          </div>
          <table className="w-full min-w-[640px] text-sm">
            <tbody className="divide-y divide-[color:var(--border)]">
              {lines.map(([key, label]) => (
                <tr key={key}>
                  <td className="px-3 py-2">{t(`hq.pnl.${label}`)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(e.totals[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!payHidden && (e.totals.fixedCostStatus === 'not_entered' || e.totals.fixedCostStatus === 'partial') && (
            <p className="border-t border-app px-3 py-2 text-xs text-muted">{t('hq.pnl.fixedNote')}</p>
          )}
          {!payHidden && e.totals.fixedCostStatus === 'unavailable' && (
            <p className="border-t border-app px-3 py-2 text-xs text-[color:var(--warning)]">{t('hq.pnl.fixedUnavailable')}</p>
          )}
        </Card>
      ))}
      {data.excluded.length > 0 && (
        <Card className="p-4 text-sm">
          <h2 className="font-semibold">{t('hq.pnl.entities.excludedTitle')}</h2>
          <p className="text-xs text-muted">{t('hq.pnl.entities.excludedHint')}</p>
          <ul className="mt-2 list-disc pl-5">
            {data.excluded.map((d) => (
              <li key={d.depotId}>
                {d.name} <span className="text-xs text-muted">{d.code}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="p-4 text-xs leading-relaxed text-muted">{data.disclaimer}</Card>
    </>
  );
}
