'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MapTrifold, NavigationArrow, Package, Sparkle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Delivery, DeliveryStatus, Page } from '@/lib/types';

const ACTIVE: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];
const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

/** Straight-line distance (km) between two lat/lng points (haversine). */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * 2f multi-stop route. ponytail: naive order (by assignedAt) with straight-line
 * leg distances between consecutive stops — wire the optimizer + real driving
 * distance/time when a batch/route API exists. The stop set + COD are real.
 */
function RouteView() {
  const { t } = useT();
  const router = useRouter();
  const list = useAsync<Page<Delivery>>(() => api.get(endpoints.deliveries.driver.list(), true), []);

  if (list.loading) return <div className="p-5"><Skeleton className="h-96 w-full" /></div>;
  if (list.error) return <div className="p-5"><ErrorState message={list.error} onRetry={list.reload} /></div>;

  const stops = (list.data?.items ?? [])
    .filter((d) => ACTIVE.includes(d.status))
    .sort((a, b) => new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime());

  if (stops.length === 0) {
    return (
      <div className="px-4 py-6">
        <CenterState icon={<Package size={32} />} title={t('courierFix.route.emptyTitle')}>
          {t('courierFix.route.emptyBody')}
        </CenterState>
      </div>
    );
  }

  // Per-stop leg distance from the previous stop (straight-line). First stop has no leg.
  const legs = stops.map((d, i) => {
    if (i === 0) return null;
    const prev = stops[i - 1];
    if (!prev) return null;
    if (
      prev.destinationLat == null || prev.destinationLng == null ||
      d.destinationLat == null || d.destinationLng == null
    )
      return null;
    return haversineKm(prev.destinationLat, prev.destinationLng, d.destinationLat, d.destinationLng);
  });
  const totalKm = legs.reduce<number>((sum, km) => sum + (km ?? 0), 0);
  // ponytail: ~3 min/km riding + 4 min per drop; replace with route-API duration.
  const estMin = Math.round(totalKm * 3 + stops.length * 4);

  return (
    <div className="space-y-3 px-4 py-5">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">{t('courierFix.route.title')}</h1>
      </header>

      {/* Map placeholder — numbered pins over a schematic grid (no SDK key yet). */}
      <Card className="relative h-40 overflow-hidden p-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg,transparent 28%,#d5ddd3 28%,#d5ddd3 32%,transparent 32%),linear-gradient(0deg,transparent 44%,#d5ddd3 44%,#d5ddd3 48%,transparent 48%),#e8ede6',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-[color:var(--muted)]">
          <MapTrifold size={26} />
        </div>
        <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-extrabold text-[color:var(--fg)] shadow-sm tabular-nums">
          {t('courierFix.route.summary', {
            stops: stops.length,
            km: totalKm.toLocaleString('id-ID', { maximumFractionDigits: 1 }),
            min: estMin,
          })}
        </span>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[color:var(--muted)] tabular-nums">
          {t('courierFix.route.summary', {
            stops: stops.length,
            km: totalKm.toLocaleString('id-ID', { maximumFractionDigits: 1 }),
            min: estMin,
          })}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-extrabold text-brand-700">
          <Sparkle size={13} weight="fill" />
          {t('courierFix.route.sorted')}
        </span>
      </div>

      <ol className="flex flex-col">
        {stops.map((d, i) => {
          const leg = legs[i];
          const isNext = i === 0;
          const cod = d.codAmount != null && d.codAmount > 0;
          return (
            <li key={d.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-[12px] font-extrabold text-white ${
                    isNext ? 'bg-brand-600' : 'bg-[color:var(--fg)]'
                  }`}
                >
                  {i + 1}
                </span>
                {i < stops.length - 1 && <span className="w-0.5 flex-1 bg-[color:var(--border)]" style={{ minHeight: 18 }} />}
              </div>
              <Link
                href={`/driver/deliveries/${d.id}`}
                className={`mb-3 flex-1 rounded-2xl bg-white p-3.5 ${
                  isNext ? 'border-2 border-brand-600' : 'border border-[color:var(--border)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-extrabold tabular-nums">{d.orderNumber}</span>
                  {isNext && <span className="text-[11px] font-extrabold text-brand-700">{t('courierFix.route.next')}</span>}
                </div>
                <div className="mt-1 text-xs leading-snug text-[color:var(--muted)]">
                  {d.destinationAddress}
                  {leg != null && ` · ${leg.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`}
                  {' · '}
                  {cod ? t('courierFix.route.cod', { amount: IDR.format(d.codAmount as number) }) : t('courierFix.route.paid')}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => stops[0] && router.push(`/driver/deliveries/${stops[0].id}`)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-sm font-extrabold text-on-brand shadow-lg shadow-brand-600/20"
      >
        <NavigationArrow size={18} weight="fill" />
        {t('courierFix.route.start')}
      </button>
    </div>
  );
}

export default function DriverRoutePage() {
  return (
    <DriverShell nav={false}>
      <RouteView />
    </DriverShell>
  );
}
