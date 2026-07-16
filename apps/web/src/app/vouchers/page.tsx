'use client';

import Link from 'next/link';
import { ArrowLeft, Ticket } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { MyVoucher, VoucherStatus } from '@/lib/types';

// Faded rendering for spent/expired/sold-out vouchers (mirrors the /rewards wallet).
const VOUCHER_MUTED: Record<VoucherStatus, boolean> = {
  AVAILABLE: false,
  USED: true,
  EXPIRED: true,
  UPCOMING: false,
  SOLD_OUT: true,
};

function VouchersInner() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<MyVoucher[]>(() =>
    api.get(endpoints.vouchers.me, true),
  );

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          href="/account"
          aria-label={t('nav.account')}
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight">{t('profile.rewards.wallet.title')}</h1>
      </div>

      {loading ? (
        <Skeleton className="h-28 w-full rounded-2xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <div
          className="rounded-2xl border border-app p-8 text-center text-sm text-muted"
          style={{ background: 'var(--surface-muted)' }}
        >
          {t('profile.rewards.wallet.empty')}
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {data.map((v) => {
            const muted = VOUCHER_MUTED[v.status];
            const fixed = v.discountType === 'FIXED';
            const discount = fixed ? formatIDR(v.value) : t('profile.rewards.wallet.pct', { pct: v.value });
            return (
              <div
                key={v.code}
                className={`surface relative flex items-center gap-3.5 rounded-[18px] border border-app px-[18px] py-4 ${muted ? 'opacity-60' : ''}`}
              >
                <span
                  className="absolute -left-[9px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full"
                  style={{ background: 'var(--surface-muted)' }}
                />
                <span
                  className="absolute -right-[9px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full"
                  style={{ background: 'var(--surface-muted)' }}
                />
                <span
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${fixed ? 'bg-[color:var(--warning-bg)]' : 'bg-brand-50'}`}
                >
                  <Ticket size={22} weight="fill" className={fixed ? 'text-[color:var(--warning)]' : 'text-brand-600'} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-extrabold leading-tight">{discount}</div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {v.description ?? t('profile.rewards.wallet.minSpend', { amount: formatIDR(v.minSpend) })}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="rounded-[7px] border border-dashed border-app px-[9px] py-[3px] font-mono text-xs font-bold tracking-wide">
                      {v.code}
                    </code>
                    {v.validUntil && (
                      <span className="text-[11.5px] text-muted">
                        {t('profile.rewards.wallet.until', {
                          date: formatDateTime(v.validUntil).split(',')[0] ?? '',
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function VouchersPage() {
  return (
    <RequireAuth>
      <VouchersInner />
    </RequireAuth>
  );
}
