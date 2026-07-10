'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Drop } from '@phosphor-icons/react';

import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { OtpChallenge } from '@/lib/types';

function RegisterForm() {
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
      setError(err instanceof ApiError ? err.message : 'Could not start registration.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Phone number" htmlFor="phone" hint="Indonesian mobile number, e.g. 081234567890">
        <Input id="phone" required inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="081234567890" />
      </Field>
      <Field label="Full name" htmlFor="fullName" hint="Optional">
        <Input id="fullName" value={form.fullName} onChange={set('fullName')} placeholder="Budi Santoso" />
      </Field>
      <Field label="Email" htmlFor="email" hint="Optional">
        <Input id="email" type="email" value={form.email} onChange={set('email')} placeholder="budi@example.com" />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} className="w-full">
        Send verification code
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-brand-700">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Drop size={40} weight="fill" className="text-brand-600" />
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="text-sm text-muted">We&apos;ll text you a one-time code to verify your number.</p>
      </div>
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
