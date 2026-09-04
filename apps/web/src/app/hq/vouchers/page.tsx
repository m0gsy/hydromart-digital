'use client';

import Link from 'next/link';
import { Ticket } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card, ErrorState, LoadError, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Page, Voucher } from '@/lib/types';

interface BurnSummary {
  totalUsed: number;
  byVoucher: Record<string, number>;
}

// Design 14b — Tata kelola voucher. Everything is real: voucher list + network/per-voucher
// burn (promo-service browse + burn-summary = SUM discountApplied).
//
// CA-2-42: the depot→HQ request queue that used to sit here is gone. See the note where it
// was rendered — a depot manager may create vouchers for their own depot, and HQ watches
// the list rather than gating it.
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
      <HqPageHeader
        icon={Ticket}
        title={t('hq.vouchers.title')}
        subtitle={t('hq.vouchers.subtitle')}
        action={
          <>
            <Link
              href="/hq/forms/voucher"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
            >
              ＋ {t('hq.vouchers.newVoucher')}
            </Link>
          </>
        }
      />

      {/* Network voucher spend — REAL (promo-service burn-summary = SUM discountApplied) */}
      <Card className="flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t('hq.vouchers.budget.title')}</h2>
          <span className="text-sm text-muted">
            {t('hq.vouchers.budget.active', { n: active.length })}
          </span>
        </div>
        <p className="text-xs uppercase tracking-wide text-muted">
          {t('hq.vouchers.budget.total')}
        </p>
        {/* Rp 0 burned is a budget report. Say the read failed instead. */}
        <p className="text-2xl font-bold tabular-nums">
          {burn.loading ? '…' : burn.error ? t('hq.common.dash') : <Money amount={totalUsed} />}
        </p>
        {burn.error && <LoadError onRetry={burn.reload} />}
      </Card>

      {/*
       * CA-2-42: the depot→HQ voucher approval queue that used to sit here is gone, by the
       * owner's decision on 2026-09-04. It never had a producer and could not get one: the
       * role that would have raised a request (MANAGER, via `voucherWrite`) can already
       * create a voucher directly on its own screen, so propose-then-approve was a second,
       * slower route to a thing the same person was already trusted to do.
       *
       * The choice was between making depots ask first and letting them print their own.
       * The owner chose the second: a depot manager may create vouchers for their depot,
       * and HQ watches the list below rather than gating it.
       */}
      {/* Voucher aktif — real list + real per-voucher burn (burn-summary byVoucher) */}
      <Card className="flex min-w-0 flex-col p-5">
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
                    <div
                      className="h-full rounded-full bg-brand-600"
                      style={{ width: `${burnPct}%` }}
                    />
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
