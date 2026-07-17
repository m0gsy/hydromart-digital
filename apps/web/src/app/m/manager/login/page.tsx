'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Drop } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { OtpChallenge } from '@/lib/types';

// Fixed brand hero — never flips under dark (same treatment as the customer login).
const HERO_GRADIENT = 'linear-gradient(150deg,#0b4d57,#0c1518)';

/**
 * Cell 1a — Depot-manager OTP login. Reuses the shared auth OTP flow (POST auth.login →
 * /verify), returning the manager to the Beranda after verification.
 */
export default function ManagerLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post<OtpChallenge>(endpoints.auth.login, { phone });
      const params = new URLSearchParams({ phone, purpose: 'LOGIN', next: '/m/manager' });
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengirim kode. Coba lagi.');
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <div
        className="relative overflow-hidden px-7 pb-12 pt-16 text-white"
        style={{ background: HERO_GRADIENT }}
      >
        <Drop
          aria-hidden
          weight="fill"
          size={190}
          className="pointer-events-none absolute -right-8 -top-8"
          style={{ color: 'rgba(255,255,255,.05)' }}
        />
        <span
          className="relative flex items-center justify-center rounded-full"
          style={{ width: 44, height: 44, background: '#5ccbdd' }}
        >
          <Drop size={24} weight="fill" style={{ color: '#16282e' }} />
        </span>
        <h1 className="relative mt-5 text-2xl font-extrabold tracking-tight">Hydromart</h1>
        <p className="relative mt-1 text-sm" style={{ color: 'rgba(255,255,255,.72)' }}>
          Konsol Manajer Depot
        </p>
      </div>

      <div className="-mt-6 flex-1 rounded-t-[24px] bg-[color:var(--surface-muted)] px-6 pt-7">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className="text-[12.5px] font-bold">
              Nomor HP terdaftar
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

          <Button
            type="submit"
            loading={loading}
            className="h-[52px] w-full rounded-[14px] text-[15px] font-extrabold"
          >
            Kirim kode OTP
            {!loading && <ArrowRight size={17} weight="bold" />}
          </Button>

          <p className="text-center text-[11.5px] text-[color:var(--text-muted)]">
            Hanya untuk staf Hydromart.
          </p>
        </form>
      </div>
    </div>
  );
}
