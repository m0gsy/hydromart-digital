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
