import { haversineKm, pointInServiceArea } from '@hydromart/platform';

import { DepotLocation } from '../application/ports/depot-directory.port';

// Moved to @hydromart/platform (S2): customer-service now prints the same in-radius verdict
// on the depot CRM card, and two copies of "how far" would eventually disagree. Re-exported
// so every existing caller and its tests keep importing it from here.
export { haversineKm };

/**
 * Picks the nearest depot that serves the point, or null when none does (or none are known).
 * A depot serves a point when it is inside the depot's drawn area if it has one, otherwise
 * when it is within `serviceRadiusKm`. "Nearest" is still by distance to the depot itself,
 * so among the depots that serve an address the closest one fulfils it.
 * Deterministic: ties break by depot id.
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
    const area = depot.serviceArea;
    if (!area?.length && !Number.isFinite(depot.serviceRadiusKm)) {
      continue;
    }
    const distance = haversineKm(lat, lng, depot.lat, depot.lng);
    // The distance ranks the candidates, so it must be a number even when an area decides.
    if (!Number.isFinite(distance)) {
      continue;
    }
    const serves = area?.length
      ? pointInServiceArea({ lat, lng }, area)
      : distance <= depot.serviceRadiusKm;
    if (!serves) {
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
