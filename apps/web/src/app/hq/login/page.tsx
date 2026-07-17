'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, LockKey, ShieldCheck } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import type { OtpChallenge, Session } from '@/lib/types';

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

// Design 13a — deep-teal HQ sign-in panel. Reuses the exact OTP flow from the
// customer login/verify pages (auth.login → auth.verifyOtp → signIn), collapsed to a
// single two-step screen. Rendered outside the HQ gate (see hq/layout.tsx).
export default function HqLoginPage() {
  const { t } = useT();
  const router = useRouter();
  const { customer, signIn } = useAuth();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Already signed in as HQ → straight to the console.
  useEffect(() => {
    if (customer && (customer.role === 'HEAD_OFFICE' || customer.role === 'SUPER_ADMIN')) {
      router.replace('/hq');
    }
  }, [customer, router]);

  const counting = cooldown > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading || phone.trim() === '') return;
    setLoading(true);
    setError(null);
    try {
      await api.post<OtpChallenge>(endpoints.auth.login, { phone: phone.trim() });
      setStep('otp');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.login.error'));
    } finally {
      setLoading(false);
    }
  }

  async function verify(value: string) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const session = await api.post<Session>(endpoints.auth.verifyOtp, {
        phone: phone.trim(),
        code: value,
        purpose: 'LOGIN',
      });
      signIn(session);
      router.replace('/hq');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.login.error'));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-[880px] overflow-hidden rounded-[24px] border border-app shadow-card md:grid-cols-2">
        {/* Deep-teal brand panel */}
        <div className="relative hidden flex-col justify-between bg-deep-teal p-10 text-white md:flex">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
              <ShieldCheck size={20} weight="fill" />
            </span>
            <span className="text-[16px] font-extrabold tracking-tight">{t('hq.rail.title')}</span>
          </div>
          <div>
            <h2 className="text-[26px] font-extrabold leading-tight">{t('hq.login.heading')}</h2>
            <p className="mt-3 max-w-[280px] text-[14px] text-white/70">{t('hq.login.hero')}</p>
          </div>
        </div>

        {/* Form */}
        <div className="surface flex flex-col justify-center gap-5 p-8 md:p-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[23px] font-extrabold tracking-tight">{t('hq.login.heading')}</h1>
            <p className="text-[13px] text-muted">{t('hq.login.subtitle')}</p>
          </div>

          {step === 'phone' ? (
            <form onSubmit={requestCode} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="hq-phone" className="text-[12.5px] font-bold">
                  {t('hq.login.phoneLabel')}
                </label>
                <div
                  className="flex items-center rounded-[14px] border-2 border-brand-600 bg-[color:var(--surface-elevated)]"
                  style={{ height: 52, padding: '0 6px 0 14px' }}
                >
                  <span className="flex items-center gap-1 whitespace-nowrap border-r border-app pr-3 text-sm font-bold">
                    🇮🇩 +62
                  </span>
                  <input
                    id="hq-phone"
                    required
                    autoFocus
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="81234567890"
                    className="h-full w-full min-w-0 bg-transparent pl-3 text-[15px] outline-none placeholder:text-[color:var(--text-muted)]"
                  />
                </div>
              </div>

              {error && (
                <p className="text-[13px] font-medium text-[color:var(--danger)]" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                loading={loading}
                className="h-[52px] w-full rounded-[14px] text-[15px] font-extrabold"
              >
                {t('hq.login.sendCode')}
                {!loading && <ArrowRight size={17} weight="bold" />}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verify(code);
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] font-bold">{t('hq.login.otpLabel')}</label>
                <p className="text-[13px] leading-relaxed text-muted">
                  {t('hq.login.otpIntro')}{' '}
                  <span className="font-bold text-[color:var(--text)]">+62 {phone}</span>
                </p>
              </div>

              <OtpInput
                value={code}
                onChange={setCode}
                length={OTP_LENGTH}
                disabled={loading}
                autoFocus
                onComplete={verify}
              />

              {error && (
                <p className="text-center text-[13px] font-medium text-[color:var(--danger)]" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                loading={loading}
                className="h-[52px] w-full rounded-[14px] text-[15px] font-extrabold"
              >
                {t('hq.login.submit')}
              </Button>

              <div className="flex items-center justify-between text-[12.5px]">
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setCode('');
                    setError(null);
                  }}
                  className="font-bold text-brand-700 transition-colors hover:text-brand-800"
                >
                  {t('hq.login.changeNumber')}
                </button>
                <button
                  type="button"
                  onClick={() => requestCode()}
                  disabled={counting}
                  className="font-bold text-brand-700 transition-colors hover:text-brand-800 disabled:cursor-not-allowed disabled:text-muted"
                >
                  {counting ? t('hq.login.resendIn', { n: cooldown }) : t('hq.login.resend')}
                </button>
              </div>
            </form>
          )}

          <p className="flex items-center gap-2 text-[11.5px] leading-relaxed text-muted">
            <LockKey size={14} weight="fill" className="shrink-0 text-brand-600" />
            {t('hq.login.note')}
          </p>
        </div>
      </div>
    </div>
  );
}
