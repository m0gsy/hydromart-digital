'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Drop } from '@phosphor-icons/react';

import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import type { OtpChallenge, OtpPurpose, Session } from '@/lib/types';

function VerifyForm() {
  const router = useRouter();
  const { signIn } = useAuth();
  const params = useSearchParams();
  const phone = params.get('phone') ?? '';
  const purpose = (params.get('purpose') as OtpPurpose) ?? 'LOGIN';
  const next = params.get('next') ?? '/products';

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await api.post<Session>(endpoints.auth.verifyOtp, { phone, code, purpose });
      signIn(session);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    setResent(null);
    try {
      const challenge = await api.post<OtpChallenge>(endpoints.auth.resendOtp, { phone, purpose });
      setResent(`A new code was sent to ${challenge.phoneMasked}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend the code.');
    }
  }

  if (!phone) {
    return (
      <p className="text-center text-sm text-muted">
        Missing phone number. Please start again from sign-in.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Verification code" htmlFor="code" hint="Enter the code we sent to your phone">
        <Input
          id="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="text-center text-lg tracking-[0.3em]"
        />
      </Field>
      {resent && <p className="text-sm text-brand-700">{resent}</p>}
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} className="w-full">
        Verify and continue
      </Button>
      <button type="button" onClick={resend} className="text-sm font-semibold text-brand-700">
        Resend code
      </button>
    </form>
  );
}

export default function VerifyPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Drop size={40} weight="fill" className="text-brand-600" />
        <h1 className="text-2xl font-bold">Verify your number</h1>
      </div>
      <Suspense fallback={null}>
        <VerifyForm />
      </Suspense>
    </div>
  );
}
