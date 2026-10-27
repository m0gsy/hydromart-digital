/** Rings the import tests reuse. Verdicts for points live with the geometry, in @hydromart/platform. */
import type { LatLng, ServiceArea } from '../../src/domain/service-area';

const p = (lat: number, lng: number): LatLng => ({ lat, lng });

// A 0.2 x 0.2 degree square.
export const SQUARE: ServiceArea = [
  [p(-6.2, 106.8), p(-6.2, 107.0), p(-6.0, 107.0), p(-6.0, 106.8)],
];

// An "L".
export const L_SHAPE: ServiceArea = [
  [p(-6.2, 106.8), p(-6.2, 107.0), p(-6.1, 107.0), p(-6.1, 106.9), p(-6.0, 106.9), p(-6.0, 106.8)],
];
