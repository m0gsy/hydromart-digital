'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Receipt } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { CourierLedgerEntry, CourierLedgerEntryType, Page } from '@/lib/types';

/*
 * The courier's full earnings cash-book.
 *
 * `GET /payout/api/v1/courier/ledger` has always existed. Its entry was REMOVED from the
 * endpoints table in an earlier audit pass, with the note: "A PAGED full history is a
 * screen nobody has built — when one is built, add the entry back with it." Nobody built
 * it, so a courier could see the last few movements on `/driver/earnings` (`recentEntries`
 * off the summary) and had no way at all to see the month before.
 *
 * That is the money they were paid. This is the screen; the endpoint entry comes back with
 * it, which is what that note asked for.
 */

const WHEN = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Dictionary KEYS at module scope, so t() runs at the call site (the pattern the sibling
// settlement-history screen already uses).
const TYPE_LABEL: Record<CourierLedgerEntryType, string> = {
  EARNING: 'hrFix.earningsHistory.typeEarning',
  DEDUCTION: 'hrFix.earningsHistory.typeDeduction',
  CASH_VARIANCE: 'hrFix.earningsHistory.typeCashVariance',
  WITHDRAWAL: 'hrFix.earningsHistory.typeWithdrawal',
  ADJUSTMENT: 'hrFix.earningsHistory.typeAdjustment',
};

const PAGE_SIZE = 20;

function History() {
  const { t } = useT();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const load = useAsync<Page<CourierLedgerEntry>>(
    () => api.get(endpoints.courierPayout.ledger(page, PAGE_SIZE), true),
    [page],
  );

  if (load.loading && !load.data) {
    return (
      <div className="p-5">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (load.error) {
    return (
      <div className="p-5">
        <ErrorState message={load.error} onRetry={load.reload} />
      </div>
    );
  }

  const items = load.data?.items ?? [];
  // `Page<T>` carries total + limit, not a page count. Derived here rather than assumed:
  // the server's own DTO has no totalPages field, and inventing one that disagrees with
  // `total` would put a "Hal 3 dari 2" on a courier's pay history.
  const total = load.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)]"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">{t('hrFix.earningsHistory.title')}</div>
      </header>

      {items.length === 0 ? (
        <CenterState icon={<Receipt size={32} />} title={t('hrFix.earningsHistory.empty')}>
          {t('hrFix.earningsHistory.emptyBody')}
        </CenterState>
      ) : (
        <>
          <Card className="divide-y divide-[color:var(--border-soft)] p-0">
            {items.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold">{entry.description}</div>
                  <div className="mt-0.5 text-[12px] text-[color:var(--muted)]">
                    {t(TYPE_LABEL[entry.type])} · {WHEN.format(new Date(entry.occurredAt))}
                  </div>
                </div>
                {/*
                  Signed: positive is money in, negative is money out. Rendering the
                  absolute value would make a deduction read exactly like a payment.
                */}
                <div
                  className={`shrink-0 text-[13.5px] font-extrabold tabular-nums ${
                    entry.amount < 0 ? 'text-red-600' : 'text-[color:var(--success)]'
                  }`}
                >
                  {entry.amount < 0 ? '−' : '+'}
                  <Money amount={Math.abs(entry.amount)} />
                </div>
              </div>
            ))}
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <Button
                variant="ghost"
                disabled={page <= 1 || load.loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('hrFix.earningsHistory.prev')}
              </Button>
              <span className="text-[12px] tabular-nums text-[color:var(--muted)]">
                {t('hrFix.earningsHistory.pageOf', { page, total: totalPages })}
              </span>
              <Button
                variant="ghost"
                disabled={page >= totalPages || load.loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('hrFix.earningsHistory.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function DriverEarningsHistoryPage() {
  return (
    <DriverShell nav={false}>
      <History />
    </DriverShell>
  );
}
