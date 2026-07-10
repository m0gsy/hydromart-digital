'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Drop } from '@phosphor-icons/react';

import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { OtpChallenge } from '@/lib/types';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/products';
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post<OtpChallenge>(endpoints.auth.login, { phone });
      const params = new URLSearchParams({ phone, purpose: 'LOGIN', next });
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start sign-in.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Phone number" htmlFor="phone" hint="The number you registered with">
        <Input id="phone" required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="081234567890" />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} className="w-full">
        Send code
      </Button>
      <p className="text-center text-sm text-muted">
        New to Hydromart?{' '}
        <Link href="/register" className="font-semibold text-brand-700">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Drop size={40} weight="fill" className="text-brand-600" />
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="text-sm text-muted">Sign in with your phone number.</p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
