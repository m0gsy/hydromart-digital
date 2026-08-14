'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, ChatCircleText, CheckCircle, MapPin, Phone, WarningCircle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { NoShowStatus } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';

type Method = 'CALL' | 'CHAT';

const CLOCK = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Audit F-16: the mm:ss clock used to live on the page, so every tick re-rendered the
 * whole screen — contact log, buttons, the lot — to move two digits. The interval lives
 * here now; the page above it only re-renders when the deadline actually passes.
 */
function Remaining({ eligibleAt }: { eligibleAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const eligibleMs = eligibleAt ? new Date(eligibleAt).getTime() : null;
  return <>{eligibleMs !== null ? mmss((eligibleMs - now) / 1000) : '05:00'}</>;
}

function NoShow() {
  const router = useRouter();
  const { t } = useT();
  const id = useQueryParam('id');
  const [status, setStatus] = useState<NoShowStatus | null>(null);
  // Session contact log — the backend returns only an attempt count, not per-attempt
  // detail, so we record method + time locally as the courier makes each attempt.
  const [log, setLog] = useState<{ method: Method; at: number }[]>([]);
  const [elapsed, setElapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleMs = status?.eligibleAt ? new Date(status.eligibleAt).getTime() : null;

  // One timer that fires ONCE, when the wait is actually over — the old per-second poll
  // existed only to notice this single transition.
  useEffect(() => {
    if (eligibleMs === null) return;
    const delay = eligibleMs - Date.now();
    if (delay <= 0) {
      setElapsed(true);
      return;
    }
    setElapsed(false);
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [eligibleMs]);

  const ready = Boolean(status?.canMarkNoShow) || (elapsed && (status?.attempts ?? 0) >= 2);

  const attempt = async (method: Method) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.post<NoShowStatus>(endpoints.deliveries.driver.contactAttempts(id), { method }, true));
      setLog((prev) => [...prev, { method, at: Date.now() }]);
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
        <button type="button" onClick={() => router.back()} className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-extrabold">{t('driver.noShow.title')}</div>
      </header>

      <Card className="flex flex-col items-center gap-2 p-6 text-center">
        <WarningCircle size={40} weight="fill" className="text-amber-500" />
        <div className="text-sm text-[color:var(--muted)]">{t('driver.noShow.body')}</div>
        <div className="mt-1 text-3xl font-extrabold tabular-nums">
          <Remaining eligibleAt={status?.eligibleAt ?? null} />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
          {t('courierFix.noShow.remainingLabel')}
        </div>
        <div className="text-[11px] text-[color:var(--muted)]">
          {t('driver.noShow.attempts', { n: status?.attempts ?? 0 })}
        </div>
      </Card>

      {log.length > 0 && (
        <Card className="p-0">
          <div className="px-4 pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
            {t('courierFix.noShow.contactHeading')}
          </div>
          {log.map((entry, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i < log.length - 1 ? 'border-b border-[color:var(--border)]' : ''}`}>
              <span className="flex size-8 items-center justify-center rounded-lg bg-green-100 text-green-700">
                {entry.method === 'CALL' ? <Phone size={16} weight="fill" /> : <ChatCircleText size={16} weight="fill" />}
              </span>
              <div className="flex-1 text-[12.5px] font-bold">
                {entry.method === 'CALL' ? t('courierFix.noShow.methodCall') : t('courierFix.noShow.methodChat')}
                <span className="tabular-nums text-[color:var(--muted)]"> · {CLOCK.format(entry.at)}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700">
                <CheckCircle size={15} weight="fill" />
                {t('courierFix.noShow.outcomeLogged')}
              </span>
            </div>
          ))}
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => attempt('CALL')}
          disabled={busy}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand-600 py-2.5 text-sm font-extrabold text-brand-700 disabled:opacity-50"
        >
          <Phone size={17} weight="fill" />
          {t('courierFix.noShow.call')}
        </button>
        <button
          type="button"
          onClick={() => attempt('CHAT')}
          disabled={busy}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand-600 py-2.5 text-sm font-extrabold text-brand-700 disabled:opacity-50"
        >
          <ChatCircleText size={17} weight="fill" />
          {t('courierFix.noShow.chat')}
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-3">
        <MapPin size={17} weight="fill" className="shrink-0 text-brand-700" />
        <span className="text-[11.5px] leading-snug text-brand-800">{t('courierFix.noShow.gpsNote')}</span>
      </div>

      <Button loading={busy} disabled={!ready} className="w-full" onClick={markNoShow}>
        {t('driver.noShow.markNoShow')}
      </Button>

      <p className="text-center text-xs text-[color:var(--muted)]">
        {t('courierFix.noShow.customerArrived')}{' '}
        <Link href={`/driver/deliveries/detail?id=${id}`} className="inline-flex min-h-11 items-center font-extrabold text-brand-700">
          {t('courierFix.noShow.continueHandover')}
        </Link>
      </p>
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
