'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ArrowLeft, Drop } from '@phosphor-icons/react';

import { Button, Card, Skeleton } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import type { OtpChallenge, OtpPurpose, Session } from '@/lib/types';

const RESEND_SECONDS = 30;

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
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verifikasi gagal.');
      setLoading(false);
    }
  }

  async function resend() {
    if (counting) return;
    setError(null);
    setResent(null);
    try {
      const challenge = await api.post<OtpChallenge>(endpoints.auth.resendOtp, { phone, purpose });
      setResent(`Kode baru dikirim ke ${challenge.phoneMasked}.`);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tidak bisa mengirim ulang kode.');
    }
  }

  if (!phone) {
    return (
      <p className="text-center text-sm text-muted">
        Nomor telepon tidak ditemukan. Silakan mulai lagi dari halaman masuk.
      </p>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); verify(code); }} className="flex flex-col gap-5">
      <p className="text-center text-sm text-muted">
        {purpose === 'REGISTRATION' ? 'Selesaikan pendaftaran.' : 'Masuk ke akunmu.'} Masukkan kode yang kami kirim ke{' '}
        <span className="font-bold text-[color:var(--text)]">{phone}</span>.
      </p>

      <OtpInput
        value={code}
        onChange={setCode}
        length={6}
        disabled={loading}
        autoFocus
        onComplete={verify}
      />

      {resent && <p className="text-center text-sm font-medium text-brand-700">{resent}</p>}
      {error && (
        <p className="text-center text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" loading={loading} className="h-12 w-full rounded-full text-[15px] font-bold">
        Verifikasi & lanjut
      </Button>

      <div className="text-center text-sm text-muted">
        Tidak menerima kode?{' '}
        <button
          type="button"
          onClick={resend}
          disabled={counting}
          className="font-bold text-brand-700 transition-colors hover:text-brand-800 disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
        >
          {counting ? `Kirim ulang dalam ${cooldown}d` : 'Kirim ulang kode'}
        </button>
      </div>
    </form>
  );
}

export default function VerifyPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <BrandMark />
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex flex-col gap-1.5 text-center">
            <h1 className="text-2xl font-extrabold tracking-tight">Verifikasi nomormu</h1>
            <p className="text-sm text-muted">Kode 6 digit berlaku beberapa menit.</p>
          </div>
          <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
            <VerifyForm />
          </Suspense>
        </Card>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-1.5 text-center text-sm font-bold text-brand-700 transition-colors hover:text-brand-800"
        >
          <ArrowLeft size={15} weight="bold" />
          Kembali ke masuk
        </Link>
      </div>
    </div>
  );
}
