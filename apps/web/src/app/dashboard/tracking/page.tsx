'use client';

import { useEffect, useRef } from 'react';
import { Lock, MapPin, NavigationArrow, Truck, User } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canViewTracking } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Delivery, DeliveryStatus, Page } from '@/lib/types';

const REFRESH_MS = 15000;

// Delivery lifecycle stepper nodes (FAILED is off-track, shown as a badge instead).
const STEPS: { status: DeliveryStatus; label: string }[] = [
  { status: 'ASSIGNED', label: 'Ditugaskan' },
  { status: 'PICKED_UP', label: 'Diambil' },
  { status: 'ON_DELIVERY', label: 'Diantar' },
  { status: 'DELIVERED', label: 'Tiba' },
];

function stepIndex(status: DeliveryStatus): number {
  const i = STEPS.findIndex((s) => s.status === status);
  return i < 0 ? -1 : i;
}

/** Great-circle km between two points (haversine). */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function relative(iso: string | null): string {
  if (!iso) return 'belum ada posisi';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs} dtk lalu`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} mnt lalu`;
  return `${Math.round(mins / 60)} jam lalu`;
}

/** Horizontal delivery-progress stepper (10a). */
function Stepper({ status }: { status: DeliveryStatus }) {
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
            <span className={`text-[10px] ${done ? 'font-semibold' : 'text-muted'}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DeliveryCard({ d }: { d: Delivery }) {
  const hasPos = d.lastLat != null && d.lastLng != null;
  const dist =
    hasPos && d.destinationLat != null && d.destinationLng != null
      ? distanceKm(d.lastLat!, d.lastLng!, d.destinationLat, d.destinationLng)
      : null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Order {d.orderNumber}</p>
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
          <span className="font-medium">Kurir #{d.driverId.slice(0, 6)}</span>
        </span>
        {dist != null && <span className="tabular-nums text-muted">{dist.toFixed(1)} km ke tujuan</span>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-app pt-3 text-sm">
        <span className="flex items-center gap-1.5 text-muted">
          <NavigationArrow size={15} weight="fill" className={hasPos ? 'text-brand-600' : 'text-muted'} />
          {hasPos ? `${d.lastLat!.toFixed(4)}, ${d.lastLng!.toFixed(4)}` : 'Menunggu posisi driver'}
        </span>
        <span className="text-xs text-muted">{relative(d.lastLocationAt)}</span>
      </div>
      {hasPos && (
        <a
          href={`https://www.google.com/maps?q=${d.lastLat},${d.lastLng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
        >
          <MapPin size={15} weight="fill" />
          Lihat di peta
        </a>
      )}
    </Card>
  );
}

function TrackingBody() {
  const list = useAsync<Page<Delivery>>(
    () => api.get(endpoints.deliveries.list({ status: 'ON_DELIVERY', limit: 50 }), true),
    [],
  );

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
        <h1 className="text-2xl font-bold">Live tracking</h1>
      </div>
      <p className="text-[12.5px] text-muted">
        Driver yang sedang mengantar. Posisi diperbarui otomatis tiap {REFRESH_MS / 1000} detik.
      </p>

      {list.loading && !list.data ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.items.length === 0 ? (
        <CenterState title="Tidak ada pengiriman aktif" icon={<Truck size={40} weight="fill" />}>
          Pengiriman yang sedang berjalan akan muncul di sini.
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.data.items.map((d) => (
            <DeliveryCard key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewTracking(customer?.role)) {
    return (
      <CenterState title="Khusus staf" icon={<Lock size={40} weight="fill" />}>
        Live tracking tersedia untuk staf depot.
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
