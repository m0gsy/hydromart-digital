'use client';

import Link from 'next/link';
import { Ticket, Info } from '@phosphor-icons/react';

import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { PENDING_VOUCHER_REQUESTS_STUB, StubBadge } from '@/lib/hq/stubs';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Page, Voucher } from '@/lib/types';

interface BurnSummary {
  totalUsed: number;
  byVoucher: Record<string, number>;
}

// Design 14b — Tata kelola voucher. The voucher list AND per-voucher/network burn are
// real (promo-service browse + burn-summary = SUM discountApplied). There is no budget
// CAP as data, so we show the real spend, not a % of a made-up ceiling. Pending depot
// voucher requests have no workflow → stays badged.
export default function HqVouchersPage() {
  const { t } = useT();
  const list = useAsync<Page<Voucher>>(() => api.get(endpoints.vouchers.browse(1, 50), true));
  const burn = useAsync<BurnSummary>(() => api.get(endpoints.vouchers.burnSummary, true));

  const vouchers = list.data?.items ?? [];
  const active = vouchers.filter((v) => v.active);
  const totalUsed = burn.data?.totalUsed ?? 0;
  const byVoucher = burn.data?.byVoucher ?? {};

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

      {/* Pending depot voucher requests — STUB */}
      <div className="flex items-center gap-2 rounded-xl bg-[color:var(--warning-bg)] px-4 py-3 text-sm font-medium text-[color:var(--warning)]">
        <Info size={18} weight="fill" />
        <span className="flex-1">{t('hq.vouchers.pending', { n: PENDING_VOUCHER_REQUESTS_STUB })}</span>
        <StubBadge />
      </div>

      {/* Voucher aktif — real list, per-voucher budget burn is STUB */}
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
