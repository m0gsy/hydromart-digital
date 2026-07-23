'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Clock, Lock, NavigationArrow, Truck, User } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT, type TVars } from '@/lib/locale-context';
import { canViewTracking } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, Delivery, DeliveryStatus, Page } from '@/lib/types';

const REFRESH_MS = 15000;
const ETA_TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

const DeliveryTrackingMap = dynamic(() => import('@/components/delivery-tracking-map'), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-2xl bg-[color:var(--surface-muted)]" />,
});

type T = (key: string, vars?: TVars) => string;

// Delivery lifecycle stepper nodes (FAILED is off-track, shown as a badge instead).
// Labels are resolved via t('dashC.tracking.steps.<status>').
const STEPS: { status: DeliveryStatus }[] = [
  { status: 'ASSIGNED' },
  { status: 'PICKED_UP' },
  { status: 'ON_DELIVERY' },
  { status: 'DELIVERED' },
];

function stepIndex(status: DeliveryStatus): number {
  const i = STEPS.findIndex((s) => s.status === status);
  return i < 0 ? -1 : i;
}

function relative(iso: string | null, t: T): string {
  if (!iso) return t('dashC.tracking.noPosition');
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return t('dashC.tracking.secsAgo', { n: secs });
  const mins = Math.round(secs / 60);
  if (mins < 60) return t('dashC.tracking.minsAgo', { n: mins });
  return t('dashC.tracking.hoursAgo', { n: Math.round(mins / 60) });
}

/** Horizontal delivery-progress stepper (10a). */
function Stepper({ status }: { status: DeliveryStatus }) {
  const { t } = useT();
  const active = stepIndex(status);
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const done = active >= 0 && i <= active;
        return (
          <li key={s.status} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              <span className={`h-1.5 flex-1 rounded-full ${i === 0 ? 'bg-transparent' : done ? 'bg-brand-500' : 'bg-[color:var(--border)]'}`} />
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${done ? 'bg-brand-600' : 'bg-[color:var(--border)]'}`} />
              <span className={`h-1.5 flex-1 rounded-full ${i === STEPS.length - 1 ? 'bg-transparent' : active > i ? 'bg-brand-500' : 'bg-[color:var(--border)]'}`} />
            </div>
            <span className={`text-[10px] ${done ? 'font-semibold' : 'text-muted'}`}>{t(`dashC.tracking.steps.${s.status}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DeliveryCard({ d, courierName }: { d: Delivery; courierName: string | null }) {
  const { t } = useT();
  const hasPos = d.lastLat != null && d.lastLng != null;
  const hasDestination = d.destinationLat != null && d.destinationLng != null;
  const eta = d.estimatedArrivalAt ? new Date(d.estimatedArrivalAt) : null;
  const hasEta = eta !== null && !Number.isNaN(eta.getTime());
  const etaMinutes = hasEta ? Math.max(0, Math.ceil((eta.getTime() - Date.now()) / 60_000)) : 0;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{t('dashC.tracking.orderLabel', { n: d.orderNumber })}</p>
          <p className="truncate text-xs text-muted">{d.destinationAddress}</p>
        </div>
        <Badge tone={d.status === 'ON_DELIVERY' ? 'brand' : d.status === 'FAILED' ? 'danger' : 'neutral'}>
          {d.status}
        </Badge>
      </div>

      {d.status !== 'FAILED' && <Stepper status={d.status} />}

      {/* Courier card. ponytail: no phone/chat (delivery record carries no driver
          contact) and no speed (only the latest position is stored, not a track). */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-app p-3 text-sm">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <User size={16} weight="fill" />
          </span>
          <span className="font-medium">
            {courierName ?? (d.driverId ? t('dashC.tracking.courier', { id: d.driverId.slice(0, 6) }) : t('opsFix.tracking.courierUnknown'))}
          </span>
        </span>
        {hasEta && (
          <span className="inline-flex items-center gap-1 tabular-nums text-muted">
            <Clock size={15} />
            {t('dashC.tracking.eta', { minutes: etaMinutes, time: ETA_TIME.format(eta) })}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-app pt-3 text-sm">
        <span className="flex items-center gap-1.5 text-muted">
          <NavigationArrow size={15} weight="fill" className={hasPos ? 'text-brand-600' : 'text-muted'} />
          {hasPos ? `${d.lastLat!.toFixed(4)}, ${d.lastLng!.toFixed(4)}` : t('dashC.tracking.awaitingPosition')}
        </span>
        <span className="text-xs text-muted">{relative(d.lastLocationAt, t)}</span>
      </div>
      {hasPos && (
        <DeliveryTrackingMap
          courier={[d.lastLat!, d.lastLng!]}
          destination={hasDestination ? [d.destinationLat!, d.destinationLng!] : null}
          courierLabel={t('dashC.tracking.mapCourier')}
          destinationLabel={t('dashC.tracking.mapDestination')}
        />
      )}
    </Card>
  );
}

function TrackingBody() {
  const { t } = useT();
  const list = useAsync<Page<Delivery>>(
    () => api.get(endpoints.deliveries.list({ status: 'ON_DELIVERY', limit: 50 }), true),
    [],
  );
  // 1c: resolve courier display names from the active-driver roster (delivery records carry
  // only driverId). Fail-soft — a roster miss falls back to the short id in the card.
  const drivers = useAsync<Customer[]>(() => api.get(endpoints.auth.drivers, true), []);
  const nameById = new Map((drivers.data ?? []).map((c) => [c.id, c.fullName]));

  // Live-ish: poll while the tab is open. useAsync.reload isn't memoized, so hold the
  // latest in a ref and run a single stable interval (no teardown per render).
  const reloadRef = useRef(list.reload);
  reloadRef.current = list.reload;
  useEffect(() => {
    const t = setInterval(() => reloadRef.current(), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Truck size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashC.tracking.heading')}</h1>
      </div>
      <p className="text-[12.5px] text-muted">
        {t('dashC.tracking.refreshNote', { n: REFRESH_MS / 1000 })}
      </p>

      {list.loading && !list.data ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.items.length === 0 ? (
        <CenterState title={t('dashC.tracking.emptyTitle')} icon={<Truck size={40} weight="fill" />}>
          {t('dashC.tracking.emptyBody')}
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.data.items.map((d) => (
            <DeliveryCard key={d.id} d={d} courierName={nameById.get(d.driverId) ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewTracking(customer?.role)) {
    return (
      <CenterState title={t('dashC.tracking.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.tracking.gateBody')}
      </CenterState>
    );
  }
  return <TrackingBody />;
}

export default function TrackingPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
