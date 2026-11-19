'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Ticket } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, Input, LoadError, Money, Skeleton } from '@/components/ui';
import { VoucherForm } from '@/components/voucher-form';
import { VoucherSummary } from '@/components/voucher-summary';
import { fetchAllDepots } from '@/lib/all-depots';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { canWriteVoucher } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import type { Page, Voucher } from '@/lib/types';

interface BurnSummary {
  totalUsed: number;
  byVoucher: Record<string, number>;
}

type StatusTab = 'all' | 'active' | 'inactive';

const PAGE = 20;

/**
 * Head office's voucher list (14b): the network's spend, and every code with where it stands.
 *
 * It used to read page one (50 rows) and drop the inactive ones in the browser, with no way to
 * edit anything. So a code saved as a draft vanished the moment it was saved, a live code past
 * the 50th newest never showed, and fixing a typo meant leaving the console. Status and search
 * are the server's now (the pages and the count are right), and a row opens the same editor the
 * create page uses.
 */
export default function HqVouchersPage() {
  const { t } = useT();
  const L = (k: string, vars?: Record<string, string | number>) => t(`hq.vouchers.list.${k}`, vars);
  const { toast } = useToast();
  const { customer } = useAuth();
  const [status, setStatus] = useState<StatusTab>('all');
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 300);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, q]);
  const [editing, setEditing] = useState<string | null>(null);

  const list = useAsync<Page<Voucher>>(
    () =>
      api.get(
        endpoints.vouchers.browse(page, PAGE, { status: status === 'all' ? undefined : status, q }),
        true,
      ),
    [page, status, q],
  );
  const burn = useAsync<BurnSummary>(() => api.get(endpoints.vouchers.burnSummary, true));
  // Names for the "where" badge. A failed read still lists the codes, as "Satu depot".
  const depots = useAsync(() => fetchAllDepots(), []);
  const names = useMemo(() => new Map((depots.data ?? []).map((d) => [d.id, d.name])), [depots.data]);
  const depotName = (id: string) => names.get(id) ?? L('oneDepot');

  const vouchers = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const byVoucher = burn.data?.byVoucher ?? {};
  const from = total === 0 ? 0 : (page - 1) * PAGE + 1;
  const to = Math.min(page * PAGE, total);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Ticket}
        title={t('hq.vouchers.title')}
        subtitle={t('hq.vouchers.subtitle')}
        action={
          <Link
            href="/hq/forms/voucher"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
          >
            ＋ {t('hq.vouchers.newVoucher')}
          </Link>
        }
      />

      {/* Network voucher spend — REAL (promo-service burn-summary = SUM discountApplied) */}
      <Card className="flex flex-col gap-2 p-5">
        <h2 className="font-semibold">{t('hq.vouchers.budget.title')}</h2>
        <p className="text-xs uppercase tracking-wide text-muted">{t('hq.vouchers.budget.total')}</p>
        {/* Rp 0 burned is a budget report. Say the read failed instead. */}
        <p className="text-2xl font-bold tabular-nums">
          {burn.loading ? '…' : burn.error ? t('hq.common.dash') : <Money amount={burn.data?.totalUsed ?? 0} />}
        </p>
        {burn.error && <LoadError onRetry={burn.reload} />}
      </Card>

      <Card className="flex min-w-0 flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{L('title')}</h2>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={L('title')}>
            {(['all', 'active', 'inactive'] as const).map((s) => (
              <Button
                key={s}
                type="button"
                role="tab"
                aria-selected={status === s}
                variant={status === s ? 'primary' : 'ghost'}
                onClick={() => setStatus(s)}
              >
                {L(s === 'all' ? 'all' : s === 'active' ? 'activeTab' : 'inactiveTab')}
              </Button>
            ))}
          </div>
        </div>
        <Input
          aria-label={L('search')}
          placeholder={L('search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {list.loading && !list.data ? (
          <Skeleton className="h-48 w-full" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : vouchers.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            {status === 'all' && !q ? L('empty') : L('emptyFiltered')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {vouchers.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <VoucherSummary voucher={v} depotName={depotName} burned={byVoucher[v.id] ?? 0} />
                  {canWriteVoucher(customer?.role, v) && (
                    <Button variant="ghost" onClick={() => setEditing(editing === v.id ? null : v.id)}>
                      {L('edit')}
                    </Button>
                  )}
                </div>
                {editing === v.id && (
                  <div className="rounded-xl border border-app p-4">
                    <VoucherForm
                      voucher={v}
                      onCancel={() => setEditing(null)}
                      onDone={() => {
                        setEditing(null);
                        toast(L('saved'), 'success');
                        list.reload();
                        burn.reload();
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {total > PAGE && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {L('prev')}
            </Button>
            <span className="text-muted">{L('range', { from, to, total })}</span>
            <Button variant="ghost" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
              {L('next')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
