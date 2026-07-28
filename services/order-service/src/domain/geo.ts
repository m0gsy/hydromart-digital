import { DepotLocation } from '../application/ports/depot-directory.port';

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in km between two lat/lng points (haversine). */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Picks the nearest depot whose service radius covers the point, or null when no
 * depot is in range (or none are known). Deterministic: ties break by depot id.
 */
export function selectNearestDepot(
  lat: number,
  lng: number,
  depots: DepotLocation[],
): DepotLocation | null {
  let best: { depot: DepotLocation; distance: number } | null = null;
  for (const depot of depots) {
    // A depot row with a missing/garbage coordinate or radius yields NaN, and every
    // NaN comparison is false — so `distance > radius` would NOT skip it and `!best`
    // would elect it, silently making one bad row swallow every address on earth.
    // Skip such rows outright: an unroutable depot is never a candidate.
    if (!Number.isFinite(depot.serviceRadiusKm)) {
      continue;
    }
    const distance = haversineKm(lat, lng, depot.lat, depot.lng);
    if (!Number.isFinite(distance) || distance > depot.serviceRadiusKm) {
      continue;
    }
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && depot.id < best.depot.id)
    ) {
      best = { depot, distance };
    }
  }
  return best?.depot ?? null;
}
