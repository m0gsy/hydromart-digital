'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowLeft, ArrowRight, Gift, User } from '@phosphor-icons/react';

import { Button, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { OtpChallenge } from '@/lib/types';

function RegisterForm() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/products';
  // E8: /login hands the number over when it has no account, so the visitor does not
  // retype what they just typed.
  const [form, setForm] = useState({ phone: params.get('phone') ?? '', fullName: '', email: '' });
  // The register endpoint takes phone/name/email only; referral redemption is a
  // separate authenticated call, so the code rides the OTP flow and is redeemed
  // on /verify once the new account is signed in.
  const [referral, setReferral] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marketing, setMarketing] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // UU PDP: explicit, recorded consent. Gate submit on it. Since tahap 2 the tick is
    // written to the consent ledger, so it is evidence rather than an inference from
    // createdAt.
    if (!agreed) {
      setError(t('auth.register.consentError'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const challenge = await api.post<OtpChallenge>(endpoints.auth.register, {
        phone: form.phone,
        fullName: form.fullName || undefined,
        email: form.email || undefined,
        // Only sent when ticked — an unticked box means "never agreed", and sending
        // false would record a refusal the customer never actually expressed.
        marketingConsent: marketing || undefined,
      });
      const onward = new URLSearchParams({ phone: form.phone, purpose: 'REGISTRATION', next });
      if (referral.trim()) onward.set('ref', referral.trim());
      // E4: the server's cooldown, carried so /verify counts the same seconds it does.
      if (challenge.resendCooldownSeconds) onward.set('cd', String(challenge.resendCooldownSeconds));
      // K1.1: the code's lifetime, so /verify can count it down and say so when it ends.
      if (challenge.expiresInSeconds) onward.set('exp', String(challenge.expiresInSeconds));
      router.push(`/verify?${onward.toString()}`);
    } catch (err) {
      // E8: the other half of one door — a number that already has an account belongs on
      // the sign-in screen, with the number already filled in.
      if (err instanceof ApiError && err.code === 'AUTH_PHONE_TAKEN') {
        router.push(`/login?${new URLSearchParams({ phone: form.phone, next }).toString()}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : t('auth.register.error'));
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ponytail: "Lewati" (skip) has no dictionary key yet — id-literal chrome. */}
      <div className="flex items-center justify-between">
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          aria-label={t('auth.register.loginCta')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-app text-[color:var(--text)] transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[16px] font-extrabold tracking-tight">{t('auth.register.heading')}</h1>
        {/*
          H11. This pointed at /products and dropped `next`, so someone who signed up
          mid-checkout and skipped landed in the catalogue with their cart behind them.
          `next` already defaults to /products, so a visitor who arrived without one sees
          no change; a gated destination still bounces at RequireAuth, which is the honest
          answer to someone who has just declined to make an account.
        */}
        <Link href={next} className="text-[13px] font-bold text-muted transition-colors hover:text-[color:var(--text)]">
          Lewati
        </Link>
      </div>

      {/*
        H11. This carried a camera badge and the caption "Tambahkan foto", and there was no
        file input behind either — nor could there be: the upload endpoint is
        `/auth/me/avatar` and this screen holds no token, because register only mints an
        OTP challenge. It was a picture of a control, and every tap on it did nothing.

        /account/edit has the real uploader, reachable the moment the account exists. The
        offer is withdrawn here rather than half-built: an avatar carried across the OTP
        hop would need the photo stashed somewhere for a screen that may never be reached.
      */}
      <div className="flex flex-col items-center gap-2">
        <span
          className="flex items-center justify-center rounded-full bg-brand-50"
          style={{ width: 78, height: 78 }}
        >
          <User size={38} weight="fill" className="text-brand-600" />
        </span>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        {/* Phone — required to start the registration → OTP flow. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-[12.5px] font-bold">
            {t('auth.register.phoneLabel')}
          </label>
          <div
            className="flex items-center rounded-[14px] border-2 border-brand-600 bg-[color:var(--surface-elevated)]"
            style={{ height: 52, padding: '0 6px 0 14px' }}
          >
            <span className="flex items-center gap-1 whitespace-nowrap border-r border-app pr-3 text-sm font-bold">
              🇮🇩 +62
            </span>
            <input
              id="phone"
              required
              inputMode="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="81234567890"
              className="h-full w-full min-w-0 bg-transparent pl-3 text-[15px] outline-none placeholder:text-[color:var(--text-muted)]"
            />
          </div>
        </div>

        {/* Full name — active teal border. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fullName" className="text-[12.5px] font-bold">
            {t('auth.register.nameLabel')}
          </label>
          <input
            id="fullName"
            value={form.fullName}
            onChange={set('fullName')}
            placeholder="Budi Santoso"
            style={{ height: 52 }}
            className="rounded-[14px] border-2 border-brand-600 bg-[color:var(--surface-elevated)] px-3.5 text-[15px] outline-none placeholder:text-[color:var(--text-muted)]"
          />
        </div>

        {/* Email (optional) — neutral border. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[12.5px] font-bold">
            {t('auth.register.emailLabel')}
          </label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="budi@example.com"
            style={{ height: 52 }}
            className="rounded-[14px] border-[1.5px] border-app bg-[color:var(--surface-elevated)] px-3.5 text-[15px] outline-none placeholder:text-[color:var(--text-muted)]"
          />
        </div>

        {/* Referral (optional) — code is carried to /verify and redeemed post-signup. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="referral" className="text-[12.5px] font-bold">{t('auth.register.referralLabel')}</label>
          <div
            className="flex items-center gap-2 rounded-[14px] border-[1.5px] border-app bg-[color:var(--surface-elevated)] px-3.5"
            style={{ height: 52 }}
          >
            <Gift size={18} className="shrink-0 text-brand-600" />
            <input
              id="referral"
              value={referral}
              onChange={(e) => setReferral(e.target.value)}
              placeholder="Punya kode teman?"
              className="h-full w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-[color:var(--text-muted)]"
            />
            <span className="whitespace-nowrap rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-800">
              {t('auth.register.bonusPoints')}
            </span>
          </div>
        </div>

        {/* UU PDP consent — required to submit. */}
        <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>
            {t('auth.register.consentPre')}
            <Link href="/kebijakan-privasi" target="_blank" className="font-bold text-brand-600 hover:underline">
              {t('auth.register.consentPrivacy')}
            </Link>
            {t('auth.register.consentPost')}
          </span>
        </label>

        {/* Optional marketing opt-in (UU PDP tahap 2). Never pre-ticked: a pre-ticked box
            is not consent, and the ledger would record it as though it were. */}
        <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>{t('auth.register.marketingOptIn')}</span>
        </label>

        {error && (
          <p className="text-[13px] font-medium text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          loading={loading}
          disabled={!agreed}
          className="mt-1 h-[52px] w-full rounded-[14px] text-[15px] font-extrabold"
        >
          {t('auth.register.submit')}
          {!loading && <ArrowRight size={17} weight="bold" />}
        </Button>

        <p className="text-center text-[13px] text-muted">
          {t('auth.register.haveAccount')}{' '}
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="font-bold text-brand-700 hover:underline"
          >
            {t('auth.register.loginCta')}
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-[390px] rounded-[24px] border border-app bg-[color:var(--surface-muted)] p-7 shadow-card">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-[14px]" />}>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
