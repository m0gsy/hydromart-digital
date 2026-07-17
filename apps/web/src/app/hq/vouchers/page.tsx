'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Ticket } from '@phosphor-icons/react';

import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Page, Voucher, VoucherRequestItem } from '@/lib/types';

interface BurnSummary {
  totalUsed: number;
  byVoucher: Record<string, number>;
}

// Design 14b — Tata kelola voucher. Everything is real: voucher list + network/per-voucher
// burn (promo-service browse + burn-summary = SUM discountApplied) and the depot→HQ voucher
// request queue (promo-service voucher-requests; approve creates the real voucher).
export default function HqVouchersPage() {
  const { t } = useT();
  const { toast } = useToast();
  const list = useAsync<Page<Voucher>>(() => api.get(endpoints.vouchers.browse(1, 50), true));
  const burn = useAsync<BurnSummary>(() => api.get(endpoints.vouchers.burnSummary, true));
  const requestsQ = useAsync<Page<VoucherRequestItem>>(() =>
    api.get(endpoints.voucherRequests.queue({ limit: 50 }), true),
  );
  const [deciding, setDeciding] = useState<string | null>(null);

  const vouchers = list.data?.items ?? [];
  const active = vouchers.filter((v) => v.active);
  const totalUsed = burn.data?.totalUsed ?? 0;
  const byVoucher = burn.data?.byVoucher ?? {};
  const requests = requestsQ.data?.items ?? [];

  async function decide(r: VoucherRequestItem, approved: boolean) {
    setDeciding(r.id);
    try {
      await api.post(
        approved ? endpoints.voucherRequests.approve(r.id) : endpoints.voucherRequests.reject(r.id),
        {},
        true,
      );
      toast(
        approved
          ? t('hq.vouchers.requests.approved', { code: r.code })
          : t('hq.vouchers.requests.rejected', { code: r.code }),
        approved ? 'success' : 'info',
      );
      requestsQ.reload();
      if (approved) list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setDeciding(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ticket size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.vouchers.title')}</h1>
            <p className="text-sm text-muted">{t('hq.vouchers.subtitle')}</p>
          </div>
        </div>
        <Link
          href="/hq/forms/voucher"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
        >
          ＋ {t('hq.vouchers.newVoucher')}
        </Link>
      </div>

      {/* Network voucher spend — REAL (promo-service burn-summary = SUM discountApplied) */}
      <Card className="flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t('hq.vouchers.budget.title')}</h2>
          <span className="text-sm text-muted">
            {t('hq.vouchers.budget.active', { n: active.length })}
          </span>
        </div>
        <p className="text-xs uppercase tracking-wide text-muted">{t('hq.vouchers.budget.total')}</p>
        <p className="text-2xl font-bold tabular-nums">
          {burn.loading ? '…' : <Money amount={totalUsed} />}
        </p>
      </Card>

      {/* Depot→HQ voucher requests — REAL (promo-service voucher-requests queue) */}
      <Card className="flex flex-col p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">{t('hq.vouchers.requests.title')}</h2>
          <span className="text-sm text-muted">
            {t('hq.vouchers.requests.pending', { n: requestsQ.data?.total ?? requests.length })}
          </span>
        </div>
        {requestsQ.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : requestsQ.error ? (
          <ErrorState message={requestsQ.error} onRetry={requestsQ.reload} />
        ) : requests.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('hq.vouchers.requests.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-app p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">{r.code}</span>
                  <span className="shrink-0 text-sm font-medium text-brand-700">
                    {r.discountType === 'PERCENTAGE'
                      ? t('hq.vouchers.requests.off', { off: r.value })
                      : t('hq.vouchers.requests.offFixed', { off: r.value.toLocaleString('id-ID') })}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {t('hq.vouchers.requests.by', { who: r.requestedBy.slice(0, 8), depot: r.depotName })}
                </p>
                {r.note ? <p className="text-xs text-muted">{r.note}</p> : null}
                <div className="flex justify-end gap-2 border-t border-app pt-2">
                  <button
                    type="button"
                    onClick={() => decide(r, false)}
                    disabled={deciding === r.id}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    {t('hq.vouchers.requests.reject')}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(r, true)}
                    disabled={deciding === r.id}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700 disabled:opacity-50"
                  >
                    {t('hq.vouchers.requests.approve')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Voucher aktif — real list + real per-voucher burn (burn-summary byVoucher) */}
      <Card className="flex flex-col p-5">
        <h2 className="mb-3 font-semibold">{t('hq.vouchers.list.title')}</h2>
        {list.loading ? (
          <Skeleton className="h-48 w-full" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : active.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('hq.vouchers.list.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {active.map((v) => {
              const burned = byVoucher[v.id] ?? 0;
              const cap = v.usageLimit ?? Math.max(v.usedCount, 50);
              const burnPct = Math.min(100, Math.round((v.usedCount / cap) * 100));
              return (
                <li key={v.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-semibold">{v.code}</span>
                      {v.description && (
                        <span className="ml-2 truncate text-sm text-muted">{v.description}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {t('hq.vouchers.list.used', { n: v.usedCount })}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${burnPct}%` }} />
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    {t('hq.vouchers.list.burn')}: <Money amount={burned} />
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
