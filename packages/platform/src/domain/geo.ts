const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in km between two lat/lng points (haversine).
 *
 * Shared, not copied. order-service decides at checkout whether an address is inside a
 * depot's service radius; customer-service prints the same verdict on the depot CRM card.
 * Two implementations of "how far" would eventually disagree, and the failure would look
 * like a data problem rather than a code one — an address the shop accepted showing as
 * out-of-area to the staff member reading the card.
 */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** A fix the phone itself rates this loose (metres) or worse is no evidence of presence. */
export const APPROXIMATE_ACCURACY_M = 1000;

/**
 * Whether a point sits on Android's "Perkiraan" (approximate location) grid.
 *
 * Android's LocationFudger snaps a coarse fix to a 2 km grid: latitude in steps of
 * 2000/111000 degrees, longitude in that step widened by 1/cos(latitude). The Galaxy and
 * Pekayon punches stored on 2026-11-23, once their fences were lifted after "1777 m dari
 * titik" refusals, sit on it exactly (-348 and 5901/5902 steps); a real GPS fix lands
 * within a millionth of a step on both axes about once in 10^11. This is what catches a
 * punch from a client that does not send its accuracy.
 *
 * Shared, not copied: hr-service refuses an attendance punch on it and delivery-service
 * names it when a courier's shift check-in is refused.
 */
export function onCoarseGrid(lat: number, lng: number): boolean {
  const latStep = 2000 / 111_000;
  const lngStep = latStep / Math.cos(toRad(lat));
  const onStep = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-6;
  return onStep(lat / latStep) && onStep(lng / lngStep);
}

/** A fix that can be up to ~2 km off: the phone says so, or the point gives it away. */
export function isApproximateFix(lat: number, lng: number, accuracyM?: number | null): boolean {
  const loose = accuracyM != null && Number.isFinite(accuracyM) && accuracyM >= APPROXIMATE_ACCURACY_M;
  return loose || onCoarseGrid(lat, lng);
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two lat/lng points, in metres (haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Geofence {
  /** Centre; null lat OR lng, or radiusM <= 0, means the geofence is DISABLED. */
  lat: number | null;
  lng: number | null;
  radiusM: number;
}

/** Whether a geofence is configured (has a centre and a positive radius). */
export function geofenceEnabled(g: Geofence): boolean {
  return (
    g.lat !== null &&
    g.lng !== null &&
    Number.isFinite(g.lat) &&
    Number.isFinite(g.lng) &&
    g.radiusM > 0
  );
}

/**
 * True when the point is allowed: inside the radius, OR the geofence is disabled
 * (unconfigured depot: record GPS but don't block). Distance is returned for logging.
 * Shared by hr-service attendance and depot-service supervisor visits.
 */
export function withinGeofence(
  g: Geofence,
  lat: number,
  lng: number,
): { ok: boolean; distanceM: number | null } {
  if (!geofenceEnabled(g)) return { ok: true, distanceM: null };
  const distanceM = haversineMeters(g.lat as number, g.lng as number, lat, lng);
  return { ok: distanceM <= g.radiusM, distanceM: Math.round(distanceM) };
}

/**
 * HD-20b: a 1 km grid cell, the coarsest place an unserved-demand row may keep (and the size of
 * a Meta pin+radius target). ponytail: a plain degree grid, 0.009 deg = ~1.0 km north-south and
 * 0.98-1.0 km east-west across Indonesia (6N to 11S); not for high latitudes, where cells narrow.
 */
const GRID_DEG = 0.009;

/** The cell a point falls in, as `<floor(lat/0.009)>:<floor(lng/0.009)>`. */
export function gridCell1km(lat: number, lng: number): string {
  return `${Math.floor(lat / GRID_DEG)}:${Math.floor(lng / GRID_DEG)}`;
}

/** The centre of a cell made by `gridCell1km`. */
export function gridCellCenter(cell: string): { lat: number; lng: number } {
  const [i, j] = cell.split(':').map(Number) as [number, number];
  return { lat: (i + 0.5) * GRID_DEG, lng: (j + 0.5) * GRID_DEG };
}
