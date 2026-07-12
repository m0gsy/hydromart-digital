'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowRight, Drop } from '@phosphor-icons/react';

import { Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { OtpChallenge } from '@/lib/types';

function BrandMark() {
  return (
    <Link href="/" className="flex items-center justify-center gap-2.5">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 shadow-card">
        <Drop size={24} weight="fill" className="text-white" />
      </span>
      <span className="text-2xl font-extrabold tracking-tight text-[color:var(--text)]">hydromart</span>
    </Link>
  );
}

function RegisterForm() {
  const { t } = useT();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/products';
  const [form, setForm] = useState({ phone: '', fullName: '', email: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post<OtpChallenge>(endpoints.auth.register, {
        phone: form.phone,
        fullName: form.fullName || undefined,
        email: form.email || undefined,
      });
      const params = new URLSearchParams({ phone: form.phone, purpose: 'REGISTRATION', next });
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.register.error'));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('auth.register.phoneLabel')} htmlFor="phone" hint={t('auth.register.phoneHint')}>
        <Input
          id="phone"
          required
          inputMode="tel"
          value={form.phone}
          onChange={set('phone')}
          placeholder="081234567890"
          className="rounded-xl"
        />
      </Field>
      <Field label={t('auth.register.nameLabel')} htmlFor="fullName" hint={t('auth.register.nameHint')}>
        <Input id="fullName" value={form.fullName} onChange={set('fullName')} placeholder="Budi Santoso" className="rounded-xl" />
      </Field>
      <Field label={t('auth.register.emailLabel')} htmlFor="email" hint={t('auth.register.emailHint')}>
        <Input id="email" type="email" value={form.email} onChange={set('email')} placeholder="budi@example.com" className="rounded-xl" />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} className="h-12 w-full rounded-full text-[15px] font-bold">
        {t('auth.register.submit')}
        {!loading && <ArrowRight size={17} weight="bold" />}
      </Button>
      <GoogleSignInButton next={next} />
      <p className="text-center text-xs leading-relaxed text-muted">
        {t('auth.register.terms')}
      </p>
    </form>
  );
}

export default function RegisterPage() {
  const { t } = useT();
  return (
    <div className="flex min-h-[70vh] items-center justify-center py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <BrandMark />
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex flex-col gap-1.5 text-center">
            <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.register.heading')}</h1>
            <p className="text-sm text-muted">{t('auth.register.subtitle')}</p>
          </div>
          <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
            <RegisterForm />
          </Suspense>
        </Card>
        <p className="text-center text-sm text-muted">
          {t('auth.register.haveAccount')}{' '}
          <Link href="/login" className="font-bold text-brand-700 transition-colors hover:text-brand-800">
            {t('auth.register.loginCta')}
          </Link>
        </p>
      </div>
    </div>
  );
}
