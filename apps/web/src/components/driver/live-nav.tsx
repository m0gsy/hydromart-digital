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

/*
 * CA-4-39. This used to divide by a hardcoded 22 km/h while the ETA the CUSTOMER is shown
 * comes from `DELIVERY_URBAN_SPEED_KMPH` — default 18, and tunable per depot. Two speeds
 * for one journey: the courier's screen and the customer's screen disagreed by about a
 * fifth, and a depot that tuned its own number moved only one of them.
 *
 * The speed is now given, not assumed. The courier settings route already answers
 * `urbanSpeedKmph` for the courier's own depot — built for exactly this in CA-4-29/CA-4-37.
 *
 * The READ belongs to the caller, not to this component: `build-mobile.mjs` prunes routes
 * per binary, and this file also ships in the OPS binary, which does not serve that route.
 * A component that fetches decides which binaries may contain it; a component that takes a
 * prop does not. (The route name is deliberately not written out anywhere in this file:
 * build-mobile.mjs scans quoted path literals, and a backticked path in a COMMENT reads
 * as one — the check flagged this comment after the fetch itself was already gone.)
 *
 * Still a straight line divided by an average: real routing needs a Directions key. What
 * changed is WHOSE average.
 */
export function etaMinutes(distanceKm: number, speedKmph: number): number {
  return Math.max(1, Math.round((distanceKm / speedKmph) * 60));
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
  /** CA-4-39: the depot's own average speed. `null` until it lands — no ETA until then. */
  speedKmph: number | null;
  destinationLat: number;
  destinationLng: number;
  onArrive: () => void;
}

/**
 * Live navigation strip shown while a delivery is ON_DELIVERY: watches the courier's
 * GPS, pings the server position every ~15s (overwrites, no history — server contract),
 * shows a rough ETA, and offers "Sampai tujuan" to advance to proof-of-delivery.
 */
export function LiveNav({
  deliveryId,
  destinationLat,
  destinationLng,
  speedKmph,
  onArrive,
}: Props) {
  const { t } = useT();
  // CA-4-39: the depot's own speed, not a constant in this file.
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

  // No speed yet means no ETA yet: "locating" is honest, a number computed from a guessed
  // speed is not.
  const eta =
    distanceKm === null || speedKmph == null ? null : etaMinutes(distanceKm, speedKmph);

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
            <span className="text-[color:var(--text-muted)]">{t('hrFix.liveNav.locating')}</span>
          ) : (
            <span className="font-bold">
              Perkiraan tiba <span className="tabular-nums">{eta} mnt</span>
              <span className="ml-1 font-normal text-[color:var(--text-muted)]">
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
