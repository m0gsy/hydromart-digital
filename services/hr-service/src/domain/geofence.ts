// Attendance GPS geofence (Rule-H). Pure, no I/O. A punch must be taken within
// `radiusM` metres of the depot's configured centre; face-match proves identity,
// GPS proves presence, the timestamp proves time — all three on every punch.
// The maths moved to @hydromart/platform so depot-service visits share it.
export {
  APPROXIMATE_ACCURACY_M,
  geofenceEnabled,
  haversineMeters,
  isApproximateFix,
  onCoarseGrid,
  withinGeofence,
  type Geofence,
} from '@hydromart/platform';
