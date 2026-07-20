'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Phone, WarningCircle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { NoShowStatus } from '@/lib/types';

function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function NoShow() {
  const router = useRouter();
  const { t } = useT();
  const id = String(useParams().id);
  const [status, setStatus] = useState<NoShowStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const eligibleMs = status?.eligibleAt ? new Date(status.eligibleAt).getTime() : null;
  const remaining = eligibleMs ? (eligibleMs - now) / 1000 : null;
  const ready = Boolean(status?.canMarkNoShow) || (remaining !== null && remaining <= 0 && (status?.attempts ?? 0) >= 2);

  const attempt = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.post<NoShowStatus>(endpoints.deliveries.driver.contactAttempts(id), { method: 'CALL' }, true));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.noShow.logError'));
    } finally {
      setBusy(false);
    }
  };

  const markNoShow = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.deliveries.driver.noShow(id), undefined, true);
      router.replace('/driver');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.noShow.markError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-extrabold">{t('driver.noShow.title')}</div>
      </header>

      <Card className="flex flex-col items-center gap-2 p-6 text-center">
        <WarningCircle size={40} weight="fill" className="text-amber-500" />
        <div className="text-sm text-[color:var(--muted)]">
          {t('driver.noShow.body')}
        </div>
        <div className="mt-1 text-3xl font-extrabold tabular-nums">
          {remaining !== null ? mmss(remaining) : '05:00'}
        </div>
        <div className="text-[11px] text-[color:var(--muted)]">
          {t('driver.noShow.attempts', { n: status?.attempts ?? 0 })}
        </div>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={attempt}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] py-2.5 text-sm font-bold disabled:opacity-50"
      >
        <Phone size={18} weight="fill" className="text-brand-700" />
        {t('driver.noShow.logAttempt')}
      </button>

      <Button loading={busy} disabled={!ready} className="w-full" onClick={markNoShow}>
        {t('driver.noShow.markNoShow')}
      </Button>
    </div>
  );
}

export default function NoShowPage() {
  return (
    <DriverShell nav={false}>
      <NoShow />
    </DriverShell>
  );
}
