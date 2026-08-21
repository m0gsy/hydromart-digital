'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BatteryCharging,
  CheckCircle,
  CloudArrowUp,
  Fingerprint,
  MapPinArea,
  Motorcycle,
  Package,
  WarningCircle,
} from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, CenterState, LoadError } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { currentPosition, GeoError } from '@/lib/geo';
import { runOrQueue } from '@/lib/offline-queue';
import { requestPushOnce } from '@/lib/push';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Delivery, DeliveryStatus, Page, Shift } from '@/lib/types';

const QUEUED: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

/** Reads the device battery level via the native Battery Status API (Chromium/HTTPS only).
 * Returns null when the API is unavailable — the checklist row falls back to a neutral hint. */
function useBatteryLevel(): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    // ponytail: navigator.getBattery is non-standard/typeless — narrow-cast, fail-soft to null.
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    let alive = true;
    nav.getBattery?.().then((b) => alive && setLevel(Math.round(b.level * 100))).catch(() => {});
    return () => { alive = false; };
  }, []);
  return level;
}

function CheckIn() {
  const router = useRouter();
  const { t } = useT();
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? null;
  const battery = useBatteryLevel();

  // Already on shift? The check-in screen has nothing to do — go to the task list.
  const current = useAsync<Shift | null>(() => api.get(endpoints.deliveries.shifts.current, true), []);
  // Orders already waiting in the depot queue for this courier's shift.
  const queue = useAsync<Page<Delivery>>(() => api.get(endpoints.deliveries.driver.list(), true), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured without signal. We must NOT jump to the task list — there is no shift on the
  // server yet, so /driver would bounce straight back here with no explanation.
  const [queuedOffline, setQueuedOffline] = useState(false);

  if (current.data && !busy) {
    router.replace('/driver');
  }

  const checkIn = async () => {
    if (!depotId) return;
    setBusy(true);
    setError(null);
    try {
      const pos = await currentPosition();
      // Depot wifi is not a given at 6am: queue the check-in rather than lose the shift start.
      const { outcome } = await runOrQueue({
        kind: 'shiftCheckIn',
        payload: { depotId, lat: pos.coords.latitude, lng: pos.coords.longitude },
      });
      if (outcome === 'queued') {
        setQueuedOffline(true);
        setBusy(false);
        return;
      }
      // The Ops binary's equivalent of the customer's first order: the one moment where
      // "let me know when a delivery lands" explains itself. Asking at first launch
      // collects a denial from someone with no reason yet to want one, and Android makes
      // that close to permanent. Not on the queued branch — there is no network there to
      // register the token with, and the next successful check-in asks instead.
      void requestPushOnce();
      router.replace('/driver');
    } catch (e) {
      // J1: this used to render `e.message` raw, believing it read "Lokasi GPS ditolak."
      // `GeoError`'s message IS its reason token, so a courier with a slow fix was shown
      // the single word "timeout". The reason still survives to the screen — translated.
      setError(
        e instanceof GeoError ? t(`errors.geo.${e.reason}`) : e instanceof ApiError ? e.message : t('driver.checkIn.error'),
      );
      setBusy(false);
    }
  };

  // No depot assigned = check-in is impossible, so this screen must not be a wall. The
  // bottom tabs are back (see DriverShell below), and the courier is pointed at the one
  // screen that can help: their profile, which names the depot contact.
  if (!depotId) {
    return (
      <CenterState icon={<WarningCircle size={32} />} title={t('driver.checkIn.noDepotTitle')}>
        {t('driver.checkIn.noDepotBody')}
        <Link
          href="/driver/profile"
          className="mt-4 inline-flex h-11 items-center rounded-full bg-brand-600 px-5 text-sm font-bold text-white"
        >
          {t('driver.checkIn.noDepotAction')}
        </Link>
      </CenterState>
    );
  }

  const queued = (queue.data?.items ?? []).filter((d) => QUEUED.includes(d.status)).length;
  const batteryLow = battery != null && battery < 50;

  return (
    <div className="flex flex-1 flex-col px-5 py-6">
      <div>
        <p className="text-xs font-bold text-[color:var(--muted)]">{t('driver.checkIn.welcome')}</p>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">{customer?.fullName ?? t('driver.checkIn.fallbackName')}</h1>
        <p className="mt-1.5 text-sm text-[color:var(--muted)]">{t('driver.checkIn.intro')}</p>
      </div>

      {/* A courier already on shift is redirected away by `current.data`. If that read
          failed there is no redirect and no sign of one, so they check in a second time
          against a shift the server already has open. */}
      {current.error && <LoadError onRetry={current.reload} />}

      {/* Start-of-shift checklist: depot location, vehicle, phone battery. */}
      <Card className="mt-4 p-0">
        <ChecklistRow
          icon={<MapPinArea size={18} weight="fill" />}
          title={t('courierFix.checkIn.depotPlacement')}
          subtitle={t('courierFix.checkIn.depotVerified')}
          ok
        />
        {/* ponytail: no vehicle record on the courier profile yet — show a neutral "ready"
            state. Wire a real vehicle field (plate + condition) when the profile has one. */}
        <ChecklistRow
          icon={<Motorcycle size={18} weight="fill" />}
          title={t('courierFix.checkIn.vehicle')}
          subtitle={t('courierFix.checkIn.vehicleCondition')}
          ok
        />
        <ChecklistRow
          icon={<BatteryCharging size={18} weight="fill" />}
          title={battery != null ? t('courierFix.checkIn.battery', { n: battery }) : t('courierFix.checkIn.batteryUnknown')}
          subtitle={batteryLow ? t('courierFix.checkIn.batteryHint') : t('courierFix.checkIn.batteryOk')}
          ok={!batteryLow}
          last
        />
      </Card>

      {queued > 0 && (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-2xl bg-brand-50 px-3.5 py-3">
          <Package size={18} weight="fill" className="shrink-0 text-brand-700" />
          <span className="text-xs leading-snug text-brand-800">{t('courierFix.checkIn.queued', { n: queued })}</span>
        </div>
      )}

      {queuedOffline && (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3">
          <CloudArrowUp size={18} weight="fill" className="shrink-0 text-amber-600" />
          <span className="text-xs leading-snug text-amber-800">{t('driver.checkIn.queuedOffline')}</span>
        </div>
      )}

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

function ChecklistRow({
  icon,
  title,
  subtitle,
  ok,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  ok: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${last ? '' : 'border-b border-[color:var(--border)]'}`}>
      <span className={`flex size-9 items-center justify-center rounded-xl ${ok ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-600'}`}>
        {icon}
      </span>
      <div className="flex-1">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-xs text-[color:var(--muted)]">{subtitle}</div>
      </div>
      {ok ? (
        <CheckCircle size={20} weight="fill" className="text-brand-600" />
      ) : (
        <WarningCircle size={20} weight="fill" className="text-amber-500" />
      )}
    </div>
  );
}

export default function CheckInPage() {
  // Bottom tabs stay ON here. /driver sends every shiftless courier to this screen, so
  // hiding the nav made it a dead end — Riwayat and Profil must remain reachable.
  return (
    <DriverShell>
      <CheckIn />
    </DriverShell>
  );
}
