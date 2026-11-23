// Attendance GPS geofence (Rule-H). Pure, no I/O. A punch must be taken within
// `radiusM` metres of the depot's configured centre; face-match proves identity,
// GPS proves presence, the timestamp proves time — all three on every punch.

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

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
 * True when the punch is allowed: inside the radius, OR the geofence is disabled
 * (unconfigured depot → record GPS but don't block). Distance is returned for logging.
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
