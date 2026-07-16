'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ArrowLeft, ChatCircleDots } from '@phosphor-icons/react';

import { Button, Skeleton } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import type { OtpChallenge, OtpPurpose, Session } from '@/lib/types';

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

function VerifyForm() {
  const { t } = useT();
  const router = useRouter();
  const { signIn } = useAuth();
  const params = useSearchParams();
  const phone = params.get('phone') ?? '';
  const purpose = (params.get('purpose') as OtpPurpose) ?? 'LOGIN';
  const next = params.get('next') ?? '/products';
  // Referral code carried from /register (spec 5c). Redeemed once, post-signup.
  const referral = params.get('ref')?.trim() ?? '';

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState<string | null>(null);
  // A code was already sent on the previous screen, so start the cooldown on mount.
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  const counting = cooldown > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  async function verify(value: string) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const session = await api.post<Session>(endpoints.auth.verifyOtp, { phone, code: value, purpose });
      signIn(session);
      // Redeem a referral code carried from registration. Fail-soft: an invalid or
      // already-used code must never block completing signup.
      if (referral && purpose === 'REGISTRATION') {
        try {
          await api.post(endpoints.referrals.redeem, { code: referral }, true);
        } catch {
          /* bad/duplicate code — signup still succeeds */
        }
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.verify.error'));
      setLoading(false);
    }
  }

  async function resend() {
    if (counting) return;
    setError(null);
    setResent(null);
    try {
      const challenge = await api.post<OtpChallenge>(endpoints.auth.resendOtp, { phone, purpose });
      setResent(t('auth.verify.sentTo', { phone: challenge.phoneMasked }));
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.verify.resendError'));
    }
  }

  if (!phone) {
    return <p className="text-center text-sm text-muted">{t('auth.verify.noPhone')}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/login"
        aria-label={t('auth.verify.back')}
        className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-app text-[color:var(--text)] transition-colors hover:bg-brand-50"
      >
        <ArrowLeft size={18} weight="bold" />
      </Link>

      <div className="flex flex-col gap-3">
        <span
          className="flex items-center justify-center rounded-[16px] bg-brand-50"
          style={{ width: 56, height: 56 }}
        >
          <ChatCircleDots size={28} weight="fill" className="text-brand-600" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[23px] font-extrabold tracking-tight">{t('auth.verify.heading')}</h1>
          <p className="text-[13px] leading-relaxed text-muted">
            {purpose === 'REGISTRATION' ? t('auth.verify.introReg') : t('auth.verify.introLogin')}{' '}
            {t('auth.verify.enterCode')}{' '}
            <span className="font-bold text-[color:var(--text)]">{phone}</span>.{' '}
            <Link href="/login" className="font-bold text-brand-700 transition-colors hover:text-brand-800">
              {t('auth.verify.back')}
            </Link>
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify(code);
        }}
        className="flex flex-col gap-4"
      >
        <OtpInput value={code} onChange={setCode} length={OTP_LENGTH} disabled={loading} autoFocus onComplete={verify} />

        {resent && <p className="text-center text-sm font-medium text-brand-700">{resent}</p>}
        {error && (
          <p className="text-center text-sm font-medium text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" loading={loading} className="h-[52px] w-full rounded-[14px] text-[15px] font-extrabold">
          {t('auth.verify.submit')}
        </Button>
      </form>

      <div className="text-center text-[12.5px] text-muted">
        {t('auth.verify.notReceived')}{' '}
        <button
          type="button"
          onClick={resend}
          disabled={counting}
          className="font-bold text-brand-700 transition-colors hover:text-brand-800 disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
        >
          {counting ? t('auth.verify.resendIn', { n: cooldown }) : t('auth.verify.resend')}
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-[390px] rounded-[24px] border border-app bg-[color:var(--surface-muted)] p-7 shadow-card">
        <Suspense fallback={<Skeleton className="h-72 w-full rounded-[14px]" />}>
          <VerifyForm />
        </Suspense>
      </div>
    </div>
  );
}
