import { haversineKm, pointInServiceArea, type ServiceArea } from '@hydromart/platform';

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

/** A change to one depot, as the reroute preview applies it (absent = unchanged). */
export interface DepotChange {
  depotId: string;
  /**
   * `false`: the depot is suspended and stops serving anyone. `true`: a closed depot
   * reopens, serving from the lat/lng/radius/area given with it.
   */
  active?: boolean;
  lat?: number;
  lng?: number;
  serviceRadiusKm?: number;
  /** P3-4: a redrawn area; null clears it, so the radius decides again. */
  serviceArea?: ServiceArea | null;
}

/** A drawn area as the HQ depot form sends it: rings of 3+ real coordinates, a sane size. */
export function isServiceArea(v: unknown): v is ServiceArea {
  return (
    Array.isArray(v) &&
    v.length <= 20 &&
    v.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 3 &&
        ring.length <= 1000 &&
        ring.every(
          (p: { lat?: unknown; lng?: unknown } | null) =>
            typeof p?.lat === 'number' &&
            typeof p.lng === 'number' &&
            Math.abs(p.lat) <= 90 &&
            Math.abs(p.lng) <= 180,
        ),
    )
  );
}

/**
 * The network after `change`. A suspended depot leaves; an edited one keeps its drawn area
 * unless a new one (or none) is given — the area still decides over a radius, exactly as
 * `selectNearestDepot` reads it.
 * A reopened depot joins the network where the change says it will serve from.
 */
export function withDepotChange(depots: DepotLocation[], change: DepotChange): DepotLocation[] {
  if (change.active === false) return depots.filter((d) => d.id !== change.depotId);
  if (
    change.active === true &&
    !depots.some((d) => d.id === change.depotId) &&
    change.lat !== undefined &&
    change.lng !== undefined &&
    change.serviceRadiusKm !== undefined
  ) {
    return [
      ...depots,
      {
        id: change.depotId,
        lat: change.lat,
        lng: change.lng,
        serviceRadiusKm: change.serviceRadiusKm,
        serviceArea: change.serviceArea ?? null,
        // Routing reads neither; a preview prices nothing.
        deliveryFee: 0,
        minOrderAmount: null,
      },
    ];
  }
  return depots.map((d) =>
    d.id === change.depotId
      ? {
          ...d,
          lat: change.lat ?? d.lat,
          lng: change.lng ?? d.lng,
          serviceRadiusKm: change.serviceRadiusKm ?? d.serviceRadiusKm,
          serviceArea: change.serviceArea === undefined ? d.serviceArea : change.serviceArea,
        }
      : d,
  );
}

export interface RerouteMove {
  fromDepotId: string | null;
  toDepotId: string | null;
  count: number;
}

export interface RerouteCounts {
  /** Active plans whose depot would change, including to none. */
  affected: number;
  /** Of those, the plans no depot would serve any more. */
  unserved: number;
  /** Largest first. */
  moves: RerouteMove[];
}

/**
 * A dry run of the sweep's own routing (`selectNearestDepot` per plan pin) before and after a
 * change to the network. Counts only: what somebody reads before closing, reopening, moving
 * or redrawing a depot, not who the customers are.
 * ponytail: 2 × pins × depots distance checks in one call — fine for hundreds of plans; route
 * only the pins the changed depot wins before or after if the network reaches tens of thousands.
 */
export function rerouteCounts(
  pins: { lat: number; lng: number }[],
  before: DepotLocation[],
  after: DepotLocation[],
): RerouteCounts {
  const moves = new Map<string, RerouteMove>();
  let unserved = 0;
  for (const pin of pins) {
    const from = selectNearestDepot(pin.lat, pin.lng, before)?.id ?? null;
    const to = selectNearestDepot(pin.lat, pin.lng, after)?.id ?? null;
    if (from === to) continue;
    if (to === null) unserved += 1;
    const key = `${from}>${to}`;
    const move = moves.get(key) ?? { fromDepotId: from, toDepotId: to, count: 0 };
    move.count += 1;
    moves.set(key, move);
  }
  const list = [...moves.values()].sort((a, b) => b.count - a.count);
  return { affected: list.reduce((n, m) => n + m.count, 0), unserved, moves: list };
}
