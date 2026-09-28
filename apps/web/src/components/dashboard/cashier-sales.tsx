'use client';

import { Card } from '@/components/ui';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { DepotDailyCashier } from '@/lib/types';

/**
 * Counter sales by the person who rang them.
 *
 * The shift screen already says whose DRAWER the cash is in; this says how much each person
 * SOLD. A row with no cashier is the "not recorded" line — sales rung before the order carried
 * one — shown as itself rather than folded into somebody, and explained once under the table
 * so the reader knows it is history, not a missing person.
 */
export function CashierSales({ rows }: { rows: readonly DepotDailyCashier[] }) {
  const { t } = useT();
  const hasUnrecorded = rows.some((r) => r.cashierId === null);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-app px-4 py-3 text-sm font-extrabold">
        {t('opsFix.reports.cashiersTitle')}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">{t('opsFix.reports.cashiersEmpty')}</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-semibold">{t('opsFix.reports.cashier')}</th>
                <th className="px-4 py-2 text-right font-semibold">{t('opsFix.reports.orders')}</th>
                <th className="px-4 py-2 text-right font-semibold">{t('opsFix.reports.revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cashierId ?? 'not-recorded'} className="border-t border-app">
                  <td className="px-4 py-2.5 font-semibold">
                    {r.cashierId === null
                      ? t('opsFix.reports.cashiersNotRecorded')
                      : (r.label ?? r.cashierId)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.orders}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatIDR(r.revenueIdr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasUnrecorded && (
            <p className="border-t border-app px-4 py-2 text-[11.5px] text-muted">
              {t('opsFix.reports.cashiersNotRecordedHint')}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
