'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CurrencyCircleDollar } from '@phosphor-icons/react';

import { SectionHeader } from '@/components/ui';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { usePagedList } from '@/lib/use-paged-list';
import type { LoanListView } from '@/lib/hr';

const PAGE_SIZE = 25;

/*
 * CA-1-34. `/hr/loans/import` could put five hundred kasbon rows into the ledger in one
 * paste, and no screen listed them: the only way to see a loan was to know whose it was
 * and open that employee. A bulk-import wizard with no list is a one-way door — nobody
 * could check what the paste actually did, or find the row that was wrong.
 *
 * The balance shown is the one payroll REALLY deducted (CA-1-05), computed by the same
 * service the employee's own screen reads, so the two cannot disagree.
 */
export default function LoansPage() {
  const { t } = useT();
  const [activeOnly, setActiveOnly] = useState(true);

  const list = usePagedList<LoanListView>(
    (page) =>
      api
        .get<{ rows: LoanListView[]; total: number }>(
          endpoints.hr.allLoans({ page, pageSize: PAGE_SIZE, activeOnly }),
          true,
        )
        .then((p) => ({ items: p.rows, total: p.total })),
    [activeOnly],
  );
  const { error, loading, reload } = list;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader
        title={t('hrFix.loans.title')}
        subtitle={list.rows.length > 0 ? t('hrFix.loans.count', { n: list.total }) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4"
          />
          {t('hrFix.loans.activeOnly')}
        </label>
        <Link
          href="/hr/loans/import"
          className="text-sm font-bold text-brand-700 underline underline-offset-2"
        >
          {t('hrFix.loans.importLink')}
        </Link>
      </div>

      {loading && list.rows.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && list.rows.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted">
          <CurrencyCircleDollar size={32} weight="thin" />
          {t('hrFix.loans.empty')}
        </Card>
      )}

      {list.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {list.rows.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {l.employeeName ?? t('hrFix.payroll.unnamedEmployee')}
                  {l.employeeCode ? ` · ${l.employeeCode}` : ''}
                </p>
                <p className="text-xs text-muted">
                  {t('hrFix.loans.terms', { period: l.startPeriod })}{' '}
                  <Money amount={Number(l.installmentAmount)} />
                  {l.note ? ` · ${l.note}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">
                  <Money amount={l.remaining} />
                </p>
                <p className="text-[11px] text-muted">{t('hrFix.loans.remaining')}</p>
              </div>
              {/* Settled and inactive are different facts: one is paid off, the other was
                  stopped by hand. A list that showed only "tidak aktif" would hide which. */}
              <Badge tone={l.settled ? 'success' : l.active ? 'brand' : 'neutral'}>
                {t(
                  l.settled
                    ? 'hrFix.loans.settled'
                    : l.active
                      ? 'hrFix.loans.running'
                      : 'hrFix.loans.stopped',
                )}
              </Badge>
            </div>
          ))}
        </Card>
      )}

      {list.hasMore && (
        <div className="flex justify-center pb-4">
          <Button variant="secondary" loading={loading} onClick={list.loadMore}>
            {t('shop.catalog.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
