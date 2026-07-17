'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowRight, Drop } from '@phosphor-icons/react';

import { Button, Card, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { OtpChallenge } from '@/lib/types';

// Fixed brand gradient — never flips under dark (spec 4c), so it's an inline literal.
const PANEL_GRADIENT = 'linear-gradient(150deg,#0b4d57,#0c1518)';

// Left hero panel — brand chrome, hidden on mobile (form-only stack).
// ponytail: hero + stat copy has no dictionary keys yet, so it's id-literal.
function BrandPanel() {
  return (
    <div
      className="relative hidden flex-col overflow-hidden text-white md:flex"
      style={{ background: PANEL_GRADIENT, padding: '48px 44px' }}
    >
      <Drop
        aria-hidden
        weight="fill"
        size={220}
        className="pointer-events-none absolute -right-10 -top-10"
        style={{ color: 'rgba(255,255,255,.05)' }}
      />
      <Link href="/" className="relative flex items-center gap-2.5">
        <span
          className="flex items-center justify-center rounded-full"
          style={{ width: 38, height: 38, background: '#5ccbdd' }}
        >
          <Drop size={20} weight="fill" style={{ color: '#16282e' }} />
        </span>
        <span className="text-[20px] font-extrabold tracking-tight">hydromart</span>
      </Link>

      <div className="relative mt-auto">
        <h2 className="font-extrabold" style={{ fontSize: 34, lineHeight: 1.15 }}>
          Air minum,
          <br />
          diantar dalam menit.
        </h2>
        <p className="mt-4 max-w-[340px]" style={{ fontSize: 14.5, color: 'rgba(255,255,255,.72)' }}>
          Galon isi ulang, air botol, dan dispenser dari depot terdekat. Masuk untuk pesan ulang sekali ketuk.
        </p>
        <div className="mt-7 flex gap-[22px]">
          <div>
            <div className="font-extrabold" style={{ fontSize: 22, color: '#8fe3ee' }}>
              30 mnt
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>rata-rata antar</div>
          </div>
          <div>
            <div className="font-extrabold" style={{ fontSize: 22, color: '#8fe3ee' }}>
              120+
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>depot mitra</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  const { t } = useT();
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
      setError(err instanceof ApiError ? err.message : t('auth.login.error'));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-[360px] flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('auth.login.heading')}</h1>
        <p className="text-[13.5px] text-muted">{t('auth.login.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-[12.5px] font-bold">
          {t('auth.login.phoneLabel')}
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

      <Button type="submit" loading={loading} className="h-[52px] w-full rounded-[14px] text-[15px] font-extrabold">
        {t('auth.login.submit')}
        {!loading && <ArrowRight size={17} weight="bold" />}
      </Button>

      <p className="text-center text-[11.5px] leading-relaxed text-muted">{t('auth.register.terms')}</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <Card className="grid w-full max-w-[1080px] overflow-hidden rounded-[24px] md:min-h-[600px] md:grid-cols-2">
        <BrandPanel />
        <div className="flex items-center justify-center px-6 py-10 md:px-14 md:py-12">
          <Suspense fallback={<Skeleton className="h-96 w-full max-w-[360px] rounded-[14px]" />}>
            <LoginForm />
          </Suspense>
        </div>
      </Card>
    </div>
  );
}
