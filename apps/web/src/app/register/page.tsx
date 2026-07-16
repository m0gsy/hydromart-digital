'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Gift, User } from '@phosphor-icons/react';

import { Button, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { OtpChallenge } from '@/lib/types';

function RegisterForm() {
  const { t } = useT();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/products';
  const [form, setForm] = useState({ phone: '', fullName: '', email: '' });
  // The register endpoint takes phone/name/email only; referral redemption is a
  // separate authenticated call, so the code rides the OTP flow and is redeemed
  // on /verify once the new account is signed in.
  const [referral, setReferral] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // UU PDP: explicit, recorded consent. Gate submit on it; the account's
    // existence (createdAt) is the consent timestamp.
    if (!agreed) {
      setError(t('auth.register.consentError'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post<OtpChallenge>(endpoints.auth.register, {
        phone: form.phone,
        fullName: form.fullName || undefined,
        email: form.email || undefined,
      });
      const params = new URLSearchParams({ phone: form.phone, purpose: 'REGISTRATION', next });
      if (referral.trim()) params.set('ref', referral.trim());
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.register.error'));
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ponytail: "Lewati" (skip) has no dictionary key yet — id-literal chrome. */}
      <div className="flex items-center justify-between">
        <Link
          href="/login"
          aria-label={t('auth.register.loginCta')}
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-app text-[color:var(--text)] transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[16px] font-extrabold tracking-tight">{t('auth.register.heading')}</h1>
        <Link href="/products" className="text-[13px] font-bold text-muted transition-colors hover:text-[color:var(--text)]">
          Lewati
        </Link>
      </div>

      {/* Avatar picker — visual only (no upload endpoint). */}
      <div className="flex flex-col items-center gap-2">
        <div className="relative">
          <span
            className="flex items-center justify-center rounded-full bg-brand-50"
            style={{ width: 78, height: 78 }}
          >
            <User size={38} weight="fill" className="text-brand-600" />
          </span>
          <span
            aria-hidden
            className="absolute bottom-0 right-0 flex items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-[color:var(--surface-muted)]"
            style={{ width: 28, height: 28 }}
          >
            <Camera size={15} weight="fill" />
          </span>
        </div>
        <p className="text-[13px] text-muted">Tambahkan foto (opsional)</p>
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
          <label htmlFor="referral" className="text-[12.5px] font-bold">
            Kode referral (opsional)
          </label>
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
              +50 poin
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
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-[390px] rounded-[24px] border border-app bg-[color:var(--surface-muted)] p-7 shadow-card">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-[14px]" />}>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
