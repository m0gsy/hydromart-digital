'use client';

import Link from 'next/link';
import { ArrowLeft, Gift, Copy, UsersThree, SealCheck, Coin } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { ReferralSummary } from '@/lib/types';

// ponytail: inline ID copy (app is ID-primary); wire useT keys when EN parity matters.
function ReferralInner() {
  const { data, error, loading, reload } = useAsync<ReferralSummary>(() =>
    api.get(endpoints.referrals.me, true),
  );

  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code);
  };

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          href="/account"
          aria-label="Akun"
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight">Ajak teman</h1>
      </div>

      {loading ? (
        <Skeleton className="h-52 w-full rounded-2xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? null : (
        <>
          <div className="surface relative overflow-hidden rounded-[20px] border border-app p-6">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-brand-700">
              <Gift size={16} weight="fill" />
              Kode referral kamu
            </div>
            <div className="mt-3 flex items-center gap-3">
              <code className="flex-1 rounded-xl border border-dashed border-app px-4 py-3 text-center font-mono text-lg font-extrabold tracking-[0.1em]">
                {data.code.code}
              </code>
              <button
                type="button"
                onClick={() => copy(data.code.code)}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700"
                aria-label="Salin kode"
              >
                <Copy size={20} weight="bold" />
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Bagikan kode ini. Teman dapat potongan di pesanan pertama, kamu dapat poin saat pesanannya selesai.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat icon={<UsersThree size={18} weight="fill" />} label="Diundang" value={data.referredCount} />
            <Stat icon={<SealCheck size={18} weight="fill" />} label="Berhasil" value={data.qualifiedCount} />
            <Stat icon={<Coin size={18} weight="fill" />} label="Poin" value={data.pointsEarned} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="surface flex flex-col gap-1.5 rounded-2xl border border-app p-4">
      <span className="text-brand-600">{icon}</span>
      <span className="text-[22px] font-extrabold leading-none tabular-nums">{value}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export default function ReferralPage() {
  return (
    <RequireAuth>
      <ReferralInner />
    </RequireAuth>
  );
}
