'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle, Crosshair, Fingerprint, MapPinArea, WarningCircle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, CenterState } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { currentPosition } from '@/lib/geo';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Shift } from '@/lib/types';

function CheckIn() {
  const router = useRouter();
  const { t } = useT();
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? null;

  // Already on shift? The check-in screen has nothing to do — go to the task list.
  const current = useAsync<Shift | null>(() => api.get(endpoints.deliveries.shifts.current, true), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (current.data && !busy) {
    router.replace('/driver');
  }

  const checkIn = async () => {
    if (!depotId) return;
    setBusy(true);
    setError(null);
    try {
      const pos = await currentPosition();
      await api.post(
        endpoints.deliveries.shifts.checkIn,
        { depotId, lat: pos.coords.latitude, lng: pos.coords.longitude },
        true,
      );
      router.replace('/driver');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.checkIn.error'));
      setBusy(false);
    }
  };

  if (!depotId) {
    return (
      <CenterState icon={<WarningCircle size={32} />} title={t('driver.checkIn.noDepotTitle')}>
        {t('driver.checkIn.noDepotBody')}
      </CenterState>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 py-6">
      <div>
        <p className="text-xs font-bold text-[color:var(--muted)]">{t('driver.checkIn.welcome')}</p>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">{customer?.fullName ?? t('driver.checkIn.fallbackName')}</h1>
        <p className="mt-1.5 text-sm text-[color:var(--muted)]">
          {t('driver.checkIn.intro')}
        </p>
      </div>

      <Card className="mt-4 flex items-center gap-3 p-4">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <MapPinArea size={20} weight="fill" />
        </span>
        <div className="flex-1">
          <div className="text-sm font-bold">{t('driver.checkIn.locationVerified')}</div>
          <div className="text-xs text-[color:var(--muted)]">
            {t('driver.checkIn.locationHint')}
          </div>
        </div>
        <Crosshair size={18} className="text-brand-600" />
      </Card>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-red-600">
          <WarningCircle size={16} weight="fill" />
          {error}
        </p>
      )}

      <div className="mt-auto pt-6">
        <Button onClick={checkIn} loading={busy} className="flex w-full items-center justify-center gap-2">
          <Fingerprint size={20} weight="fill" />
          {t('driver.checkIn.submit')}
        </Button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-[color:var(--muted)]">
          <CheckCircle size={14} weight="fill" className="text-brand-600" />
          {t('driver.checkIn.locationNote')}
        </p>
      </div>
    </div>
  );
}

export default function CheckInPage() {
  return (
    <DriverShell nav={false}>
      <CheckIn />
    </DriverShell>
  );
}
