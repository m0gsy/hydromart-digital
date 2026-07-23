'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Broadcast, Coffee, Moon } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { currentPosition } from '@/lib/geo';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Shift, ShiftStatus } from '@/lib/types';

const OPTIONS: { value: Exclude<ShiftStatus, 'ENDED'>; labelKey: string; hintKey: string; icon: typeof Broadcast; tone: string }[] = [
  { value: 'ONLINE', labelKey: 'onlineLabel', hintKey: 'onlineHint', icon: Broadcast, tone: 'text-green-700' },
  { value: 'BREAK', labelKey: 'breakLabel', hintKey: 'breakHint', icon: Coffee, tone: 'text-amber-700' },
  { value: 'OFFLINE', labelKey: 'offlineLabel', hintKey: 'offlineHint', icon: Moon, tone: 'text-[color:var(--muted)]' },
];

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ShiftStatusScreen() {
  const router = useRouter();
  const { t } = useT();
  const shift = useAsync<Shift | null>(() => api.get(endpoints.deliveries.shifts.current, true), []);
  const [busy, setBusy] = useState<ShiftStatus | 'ENDED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, key: ShiftStatus | 'ENDED') => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      shift.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.shiftStatus.actionError'));
    } finally {
      setBusy(null);
    }
  };

  if (shift.loading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (shift.error) return <div className="p-5"><ErrorState message={shift.error} onRetry={shift.reload} /></div>;
  if (!shift.data) {
    return (
      <CenterState icon={<Moon size={32} />} title={t('driver.shiftStatus.noShiftTitle')}>
        {t('driver.shiftStatus.noShiftBody')}
      </CenterState>
    );
  }

  const s = shift.data;
  const setStatus = (status: Exclude<ShiftStatus, 'ENDED'>) =>
    act(() => api.patch(endpoints.deliveries.shifts.status(s.id), { status }, true), status);

  const checkOut = async () => {
    const pos = await currentPosition();
    await act(
      () => api.post(endpoints.deliveries.shifts.checkOut(s.id), { lat: pos.coords.latitude, lng: pos.coords.longitude }, true),
      'ENDED',
    );
    router.replace('/driver/shift/check-in');
  };

  return (
    <div className="space-y-4 px-5 py-6">
      <h1 className="text-lg font-extrabold tracking-tight">{t('driver.shiftStatus.title')}</h1>

      {s.status === 'BREAK' && (
        <Card className="bg-amber-50 p-5 text-center">
          <div className="text-3xl font-extrabold tabular-nums">{fmt(s.breakSecondsRemaining)}</div>
          <div className="mt-1 text-xs text-amber-800">{t('driver.shiftStatus.breakRemaining')}</div>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {OPTIONS.map(({ value, labelKey, hintKey, icon: Icon, tone }) => {
          const active = s.status === value;
          return (
            <button
              key={value}
              type="button"
              disabled={busy != null}
              onClick={() => setStatus(value)}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left ${
                active ? 'border-brand-500 bg-brand-50' : 'border-[color:var(--border)] bg-[color:var(--surface)]'
              }`}
            >
              <span className={`flex size-9 items-center justify-center rounded-xl bg-black/5 ${tone}`}>
                <Icon size={19} weight="fill" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-extrabold">{t(`driver.shiftStatus.options.${labelKey}`)}</span>
                <span className="block text-xs text-[color:var(--muted)]">{t(`driver.shiftStatus.options.${hintKey}`)}</span>
              </span>
              <span className={`size-5 rounded-full border-2 ${active ? 'border-brand-500 bg-brand-500' : 'border-[color:var(--border)]'}`} />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={busy != null}
        onClick={checkOut}
        className="w-full rounded-2xl border border-[color:var(--border)] p-3.5 text-sm font-extrabold text-red-600"
      >
        {t('driver.shiftStatus.checkOut')}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs leading-relaxed text-[color:var(--muted)]">
        {t('driver.shiftStatus.info')}
      </p>
    </div>
  );
}

export default function ShiftStatusPage() {
  return (
    <DriverShell>
      <ShiftStatusScreen />
    </DriverShell>
  );
}
