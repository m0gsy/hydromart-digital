'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { ArrowLeft, CheckCircle, Gift, Copy, UsersThree, SealCheck, Coin } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useReferralRules } from '@/lib/referral-rules';
import { useAsync } from '@/lib/use-async';
import type { ReferralSummary } from '@/lib/types';

// ponytail: inline ID copy (app is ID-primary); wire useT keys when EN parity matters.
function ReferralInner() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<ReferralSummary>(() =>
    api.get(endpoints.referrals.me, true),
  );
  // CA-3-45: the sentence below names both rewards, so it reads them from the settings
  // that pay them. Dashed until they land — a promise with a made-up number in it is the
  // bug this row is about.
  const rules = useReferralRules().data;

  /*
   * CA-3-47. Two faults in one line. `void navigator.clipboard?.writeText(code)` said
   * nothing on success, so a tap that worked and a tap that did nothing looked identical —
   * and the `?.` swallowed the one case that actually happens (a blocked or absent
   * clipboard on an insecure origin or an old WebView) without a word.
   *
   * This is the shape /vouchers and /rewards already use. The `?.` is dropped on purpose:
   * inside the try/catch a missing `navigator.clipboard` throws and lands in the same
   * branch, so the two failure modes stop diverging.
   */
  const [copied, setCopied] = useState(false);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is on screen, same fallback as /vouchers */
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          href="/account"
          aria-label={t('hrFix.referral.accountAria')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="hidden text-[22px] font-extrabold tracking-tight sm:block">{t('hrFix.referral.title')}</h1>
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
              {t('hrFix.referral.yourCode')}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <code className="flex-1 rounded-xl border border-dashed border-app px-4 py-3 text-center font-mono text-lg font-extrabold tracking-[0.1em]">
                {data.code.code}
              </code>
              <button
                type="button"
                onClick={() => void copy(data.code.code)}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700"
                aria-label={copied ? t('profile.rewards.wallet.copied') : t('hrFix.referral.copyAria')}
              >
                {copied ? <CheckCircle size={20} weight="fill" /> : <Copy size={20} weight="bold" />}
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              {t('hrFix.referral.shareHint', {
                referrer: rules ? String(rules.referrerPoints) : '—',
                referee: rules ? String(rules.refereePoints) : '—',
              })}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat icon={<UsersThree size={18} weight="fill" />} label={t('hrFix.referral.invited')} value={data.referredCount} />
            <Stat icon={<SealCheck size={18} weight="fill" />} label={t('hrFix.referral.succeeded')} value={data.qualifiedCount} />
            <Stat icon={<Coin size={18} weight="fill" />} label={t('hrFix.referral.points')} value={data.pointsEarned} />
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
