'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/locale-context';
import { MapPinLine, WarningCircle } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';

/** Great-circle distance in km between two lat/lng points (haversine). */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ponytail: crude ETA — straight-line distance ÷ a fixed city-scooter speed. Real routing
// (traffic, turn-by-turn) needs a Maps Directions key; tune AVG_SPEED_KMH once we have
// field data on actual courier pace.
const AVG_SPEED_KMH = 22;

/** Rough minutes-to-destination from straight-line distance. `null` if we have no fix yet. */
export function etaMinutes(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / AVG_SPEED_KMH) * 60));
}

const PING_INTERVAL_MS = 15_000;

/**
 * Decide whether to POST a fresh position: only once we've moved past the interval
 * since the last ping. Pure so the scheduler is unit-testable without a real clock.
 */
export function shouldPing(lastPingAt: number | null, now: number): boolean {
  return lastPingAt === null || now - lastPingAt >= PING_INTERVAL_MS;
}

interface Props {
  deliveryId: string;
  destinationLat: number;
  destinationLng: number;
  onArrive: () => void;
}

/**
 * Live navigation strip shown while a delivery is ON_DELIVERY: watches the courier's
 * GPS, pings the server position every ~15s (overwrites, no history — server contract),
 * shows a rough ETA, and offers "Sampai tujuan" to advance to proof-of-delivery.
 */
export function LiveNav({ deliveryId, destinationLat, destinationLng, onArrive }: Props) {
  const { t } = useT();
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [geoError, setGeoError] = useState(false);
  const lastPingAt = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeoError(true);
      return;
    }
    // A watch, so `currentPosition` (single-shot) is not the shared helper to reuse here —
    // but the same fallback is: a courier who granted "Perkiraan" (Android 12+) holds
    // COARSE only, and a precise-only watch on that phone never produces a fix. Giving up
    // on the first error left the delivery screen with no distance and no pings for the
    // whole trip. So: downgrade once, then stay.
    let watchId: number;
    let downgraded = false;
    const start = (high: boolean) =>
      navigator.geolocation.watchPosition(
        (pos) => {
          setGeoError(false);
          const { latitude, longitude } = pos.coords;
          setDistanceKm(haversineKm(latitude, longitude, destinationLat, destinationLng));
          const now = Date.now();
          if (shouldPing(lastPingAt.current, now)) {
            lastPingAt.current = now;
            // Fire-and-forget: a dropped ping just means the map is a few seconds stale.
            void api.post(endpoints.deliveries.driver.location(deliveryId), { lat: latitude, lng: longitude }, true).catch(() => {});
          }
        },
        (err) => {
          // A refusal cannot be retried into a yes; anything else gets the coarse provider.
          if (!downgraded && err.code !== err.PERMISSION_DENIED) {
            downgraded = true;
            navigator.geolocation.clearWatch(watchId);
            watchId = start(false);
            return;
          }
          setGeoError(true);
        },
        high
          ? { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
          : { enableHighAccuracy: false, maximumAge: 30000, timeout: 30000 },
      );
    watchId = start(true);
    return () => navigator.geolocation.clearWatch(watchId);
  }, [deliveryId, destinationLat, destinationLng]);

  const eta = distanceKm === null ? null : etaMinutes(distanceKm);

  return (
    <div className="space-y-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      {geoError ? (
        <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
          <WarningCircle size={18} weight="fill" />
          {t('hrFix.liveNav.gpsOff')}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <MapPinLine size={18} weight="fill" className="text-brand-700" />
          {eta === null ? (
            <span className="text-[color:var(--muted)]">{t('hrFix.liveNav.locating')}</span>
          ) : (
            <span className="font-bold">
              Perkiraan tiba <span className="tabular-nums">{eta} mnt</span>
              <span className="ml-1 font-normal text-[color:var(--muted)]">
                · {distanceKm!.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km
              </span>
            </span>
          )}
        </div>
      )}
      <Button className="w-full" onClick={onArrive}>
        {t('hrFix.liveNav.arrived2')}
      </Button>
    </div>
  );
}
