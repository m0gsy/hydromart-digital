/**
 * A depot's drawn service area: one or more simple polygons ("rings") of lat/lng points.
 * A point is served when it is inside ANY ring (the union), boundary included.
 *
 * Strictness is the point. A ring that crosses itself or collapses to a line still "works"
 * under a ray-cast test, it just answers wrongly for part of the map, and a customer inside
 * the depot's real area would be told they are outside it. So a bad ring is rejected here,
 * at import time, rather than discovered at checkout.
 *
 * Pure and dependency-free so the same algorithm can be mirrored byte-for-byte by
 * order-service and the web checkout; `test/fixtures/service-area-cases.json` is the shared
 * set of points all three must agree on.
 */
export interface LatLng {
  lat: number;
  lng: number;
}
export type ServiceArea = LatLng[][];

export type AreaParsed = { ok: true; value: ServiceArea | null } | { ok: false; error: string };

export const MAX_RINGS = 5;
export const MAX_RING_POINTS = 200;
// A ring whose shoelace area is below this (square degrees, ~1 m²) is a line, not a region.
const MIN_AREA = 1e-10;

const sameSpot = (a: LatLng, b: LatLng): boolean => a.lat === b.lat && a.lng === b.lng;

function validPoint(p: unknown): p is LatLng {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Twice the signed area of triangle (a, b, c); 0 when collinear. */
const cross = (a: LatLng, b: LatLng, c: LatLng): number =>
  (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);

/** c is on segment a-b, given the three are collinear. */
const within = (a: LatLng, b: LatLng, c: LatLng): boolean =>
  Math.min(a.lng, b.lng) <= c.lng &&
  c.lng <= Math.max(a.lng, b.lng) &&
  Math.min(a.lat, b.lat) <= c.lat &&
  c.lat <= Math.max(a.lat, b.lat);

/** Do segments a-b and c-d share any point (crossing, touching or overlapping)? */
function segmentsMeet(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
  const d1 = Math.sign(cross(a, b, c));
  const d2 = Math.sign(cross(a, b, d));
  const d3 = Math.sign(cross(c, d, a));
  const d4 = Math.sign(cross(c, d, b));
  // Proper crossing, and also an endpoint resting on the other segment: a zero sign on one
  // side still differs from the nonzero sign of its partner, and the products stay <= 0.
  if (d1 !== d2 && d3 !== d4) return true;
  // All four collinear: the segments meet only if their extents overlap.
  return d1 === 0 && d2 === 0 && (within(a, b, c) || within(a, b, d) || within(c, d, a));
}

function ringError(ring: LatLng[]): string | null {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    // Two consecutive edges that double back on themselves: a zero-width spike.
    const c = ring[(i + 2) % n];
    if (cross(a, b, c) === 0 && (b.lng - a.lng) * (c.lng - b.lng) + (b.lat - a.lat) * (c.lat - b.lat) < 0) {
      return 'ada sisi yang berbalik arah pada garis yang sama';
    }
    for (let j = i + 2; j < n; j += 1) {
      // The first and last edges are neighbours through the closing point.
      if (i === 0 && j === n - 1) continue;
      if (segmentsMeet(a, b, ring[j], ring[(j + 1) % n])) return 'sisi-sisinya saling berpotongan';
    }
  }
  // After the crossing test: a bow-tie also sums to zero area, and "crosses itself" is the
  // truthful message for it.
  let twice = 0;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    twice += a.lng * b.lat - b.lng * a.lat;
  }
  if (Math.abs(twice) / 2 < MIN_AREA) return 'titik-titiknya satu garis, bukan area';
  return null;
}

/**
 * `[[{lat,lng},...], ...]`. Absent / `[]` means "no drawn area" (radius routing) and parses
 * to `null`. A ring may repeat its first point at the end (it is dropped) and consecutive
 * duplicates are collapsed; at least three distinct corners must remain.
 */
export function parseServiceArea(input: unknown): AreaParsed {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (!Array.isArray(input)) return { ok: false, error: 'area layanan harus berupa daftar poligon' };
  if (input.length === 0) return { ok: true, value: null };
  if (input.length > MAX_RINGS) {
    return { ok: false, error: `area layanan maksimal ${MAX_RINGS} poligon` };
  }

  const rings: ServiceArea = [];
  for (let r = 0; r < input.length; r += 1) {
    const where = `poligon ${r + 1}`;
    const raw: unknown = input[r];
    if (!Array.isArray(raw)) return { ok: false, error: `${where}: harus berupa daftar titik` };
    if (raw.length > MAX_RING_POINTS + 1) {
      return { ok: false, error: `${where}: maksimal ${MAX_RING_POINTS} titik` };
    }
    const ring: LatLng[] = [];
    for (const p of raw) {
      if (!validPoint(p)) {
        return { ok: false, error: `${where}: titik harus {lat, lng} dengan koordinat yang valid` };
      }
      const point = { lat: p.lat, lng: p.lng };
      if (ring.length === 0 || !sameSpot(ring[ring.length - 1], point)) ring.push(point);
    }
    if (ring.length > 1 && sameSpot(ring[0], ring[ring.length - 1])) ring.pop();
    if (ring.length < 3) return { ok: false, error: `${where}: butuh minimal 3 titik berbeda` };
    if (ring.length > MAX_RING_POINTS) {
      return { ok: false, error: `${where}: maksimal ${MAX_RING_POINTS} titik` };
    }
    const bad = ringError(ring);
    if (bad) return { ok: false, error: `${where}: ${bad}` };
    rings.push(ring);
  }
  return { ok: true, value: rings };
}

function inRing(point: LatLng, ring: LatLng[]): boolean {
  const n = ring.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
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

/** Is the point inside any ring (boundary included)? */
export function pointInServiceArea(point: LatLng, area: ServiceArea): boolean {
  return area.some((ring) => inRing(point, ring));
}
