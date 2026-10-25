'use client';

import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { FormError } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { dateInDaysWib, monthWib, todayWib } from '@/lib/wib';
import type { CashbookResponse, DailyCloseView, MonthlyCloseView } from '@/lib/types';

const dash = '—';

/** A close that was reopened is open again: the books are not sealed until it is closed once more. */
const sealed = (close: { reopenedAt: string | null } | null | undefined): boolean =>
  close != null && close.reopenedAt == null;

/**
 * Buku kas & tutup buku: what went in and out of the depot's cash book in the window, and
 * whether today, yesterday and this month have been closed ("tutup buku").
 *
 * Needs one depot. The ledger needs the finance capability and the close state needs the
 * close capability: a role with one of them sees that half.
 */
export function BooksCard({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotId } = ctx;
  const mayBook = can('depotFinance', role);
  const mayClose = can('dailyClose', role);
  const has = depotId != null;
  const today = todayWib();
  const yesterday = dateInDaysWib(-1);
  const month = monthWib();

  // The cash book includes its upper bound, and the window excludes its own: step back a ms.
  const until = new Date(Date.parse(range.to) - 1).toISOString();
  const book = useInsightData(
    () =>
      api.get<CashbookResponse>(
        endpoints.cashbook.list({ depotId: depotId as string, from: range.from, to: until }),
        true,
      ),
    [depotId, range.from, range.to],
    mayBook && has,
  );
  const dayOf = (date: string) =>
    api.get<DailyCloseView>(endpoints.depots.dailyClose(depotId as string, date), true);
  const closedToday = useInsightData(() => dayOf(today), [depotId, today], mayClose && has);
  const closedYesterday = useInsightData(
    () => dayOf(yesterday),
    [depotId, yesterday],
    mayClose && has,
  );
  const closedMonth = useInsightData(
    () => api.get<MonthlyCloseView>(endpoints.depots.monthlyClose(depotId as string, month), true),
    [depotId, month],
    mayClose && has,
  );

  if (!has || (!mayBook && !mayClose)) return null;
  const summary = book.data?.summary;

  const dayLine = (label: string, view: DailyCloseView | null) => {
    if (view == null) return `${label}: ${dash}`;
    if (!sealed(view.close)) return `${label}: ${t('insight.books.open')}`;
    const late =
      view.lateEntries > 0
        ? ` · ${t('insight.books.late', { n: view.lateEntries, amount: formatIDR(view.lateAmountIdr) })}`
        : '';
    return `${label}: ${t('insight.books.closedAt', { at: formatDateTime(view.close!.closedAt) })}${late}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {mayBook && !book.forbidden && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label={t('insight.books.in')}
            value={summary ? formatIDR(summary.inIdr) : dash}
            definition={t('insight.books.inDef')}
          />
          <KpiCard
            label={t('insight.books.out')}
            value={summary ? formatIDR(summary.outIdr) : dash}
            definition={t('insight.books.outDef')}
          />
          <KpiCard
            label={t('insight.books.net')}
            value={summary ? formatIDR(summary.netIdr) : dash}
            definition={t('insight.books.netDef')}
          />
        </section>
      )}
      {book.error && <FormError message={t('common.loadFailed')} />}

      {mayClose && !closedToday.forbidden && (
        <WidgetCard
          title={t('insight.books.closeTitle')}
          source={closedToday}
          detailHref="/dashboard/reports"
        >
          {(todayView) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              <li>{dayLine(t('insight.books.today'), todayView)}</li>
              <li>{dayLine(t('insight.books.yesterday'), closedYesterday.data)}</li>
              <li>
                {closedMonth.data == null
                  ? `${t('insight.books.month')}: ${dash}`
                  : sealed(closedMonth.data.close)
                    ? `${t('insight.books.month')}: ${t('insight.books.closedAt', { at: formatDateTime(closedMonth.data.close!.closedAt) })}`
                    : `${t('insight.books.month')}: ${t('insight.books.monthOpen', { n: closedMonth.data.missingDays.length })}`}
              </li>
            </ul>
          )}
        </WidgetCard>
      )}
    </div>
  );
}
