/**
 * A depot's drawn service area and the one test that decides whether a point is inside it.
 *
 * Lives here, not in depot-service, because three services must give the same verdict for
 * the same coordinates: depot-service says `withinService` on the nearby list, order-service
 * decides at checkout which depot serves an address, customer-service prints the verdict on
 * the depot CRM card. Two copies of a geometry routine drift; this is the one.
 *
 * Parsing and validating an area from user input stays in depot-service
 * (`domain/service-area.ts`) because only the import writes one.
 */
import { haversineKm } from './geo';

export interface LatLng {
  lat: number;
  lng: number;
}
/** Outer rings of simple polygons; a point is served when it is inside ANY of them. */
export type ServiceArea = LatLng[][];

/** Twice the signed area of triangle (a, b, c); 0 when collinear. */
export const cross = (a: LatLng, b: LatLng, c: LatLng): number =>
  (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);

/** c is on segment a-b, given the three are collinear. */
export const within = (a: LatLng, b: LatLng, c: LatLng): boolean =>
  Math.min(a.lng, b.lng) <= c.lng &&
  c.lng <= Math.max(a.lng, b.lng) &&
  Math.min(a.lat, b.lat) <= c.lat &&
  c.lat <= Math.max(a.lat, b.lat);

function inRing(point: LatLng, ring: LatLng[]): boolean {
  const n = ring.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = ring[i] as LatLng;
    const b = ring[j] as LatLng;
    // On an edge counts as inside, so a customer standing exactly on a drawn boundary is served.
    if (cross(a, b, point) === 0 && within(a, b, point)) return true;
    if (
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Is the point inside any ring (boundary included)? An empty area contains nothing. */
export function pointInServiceArea(point: LatLng, area: ServiceArea): boolean {
  return area.some((ring) => inRing(point, ring));
}

/** What decides whether a depot serves a point: where it is, its radius, its drawn area. */
export interface ServingDepot {
  id: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number | null;
  serviceArea?: ServiceArea | null;
}

/**
 * The one rule: a depot serves a point inside its drawn area when it has one, otherwise
 * within its radius. A depot that cannot be placed (garbage coordinate) or has neither a
 * usable area nor a finite radius serves nobody: NaN comparisons are false, so without this
 * one bad row would "serve" every address on earth.
 */
export function depotServes(point: LatLng, depot: ServingDepot): boolean {
  const distance = haversineKm(point.lat, point.lng, depot.lat, depot.lng);
  if (!Number.isFinite(distance)) return false;
  if (depot.serviceArea?.length) return pointInServiceArea(point, depot.serviceArea);
  return Number.isFinite(depot.serviceRadiusKm) && distance <= (depot.serviceRadiusKm as number);
}

/** The nearest depot that serves the point (ties by id), or null. Checkout, CRM and prospects use this. */
export function servingDepot<T extends ServingDepot>(point: LatLng, depots: T[]): T | null {
  let best: { depot: T; distance: number } | null = null;
  for (const depot of depots) {
    if (!depotServes(point, depot)) continue;
    const distance = haversineKm(point.lat, point.lng, depot.lat, depot.lng);
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

/**
 * Read a stored/wire value defensively: anything that is not a non-empty list of rings of
 * numeric points reads as "no drawn area" (radius routing), never as an area that contains
 * nothing — which would make a malformed row stop serving anyone.
 */
export function readServiceArea(value: unknown): ServiceArea | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rings: ServiceArea = [];
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length < 3) return null;
    const ring: LatLng[] = [];
    for (const p of raw) {
      const { lat, lng } = (p ?? {}) as Record<string, unknown>;
      if (typeof lat !== 'number' || typeof lng !== 'number') return null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      ring.push({ lat, lng });
    }
    rings.push(ring);
  }
  return rings;
}
