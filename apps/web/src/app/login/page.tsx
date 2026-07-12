'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowRight, Drop } from '@phosphor-icons/react';

import { Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
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
      setError(err instanceof ApiError ? err.message : 'Tidak bisa memulai proses masuk.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Nomor telepon" htmlFor="phone" hint="Nomor yang kamu daftarkan">
        <Input
          id="phone"
          required
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="081234567890"
          className="rounded-xl"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} className="h-12 w-full rounded-full text-[15px] font-bold">
        Kirim kode
        {!loading && <ArrowRight size={17} weight="bold" />}
      </Button>
      <GoogleSignInButton next={next} />
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <BrandMark />
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex flex-col gap-1.5 text-center">
            <h1 className="text-2xl font-extrabold tracking-tight">Selamat datang kembali</h1>
            <p className="text-sm text-muted">Masuk dengan nomor teleponmu — kami kirim kode sekali pakai.</p>
          </div>
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <LoginForm />
          </Suspense>
        </Card>
        <p className="text-center text-sm text-muted">
          Belum punya akun?{' '}
          <Link href="/register" className="font-bold text-brand-700 transition-colors hover:text-brand-800">
            Daftar sekarang
          </Link>
        </p>
      </div>
    </div>
  );
}
