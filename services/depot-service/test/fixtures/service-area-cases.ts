/**
 * The agreed answers for "is this point inside this service area". order-service and the web
 * checkout copy this table next to their own implementation of the same test, so the three
 * cannot drift apart: a customer must get the same verdict from every layer.
 */
import type { LatLng, ServiceArea } from '../../src/domain/service-area';

const p = (lat: number, lng: number): LatLng => ({ lat, lng });

// A 0.2 x 0.2 degree square.
export const SQUARE: ServiceArea = [
  [p(-6.2, 106.8), p(-6.2, 107.0), p(-6.0, 107.0), p(-6.0, 106.8)],
];

// An "L": the notch (lat > -6.1, lng > 106.9) is outside.
export const L_SHAPE: ServiceArea = [
  [p(-6.2, 106.8), p(-6.2, 107.0), p(-6.1, 107.0), p(-6.1, 106.9), p(-6.0, 106.9), p(-6.0, 106.8)],
];

// Two separate squares; a point in either is served, the gap between them is not.
export const TWO_RINGS: ServiceArea = [
  [p(-6.2, 106.8), p(-6.2, 106.9), p(-6.1, 106.9), p(-6.1, 106.8)],
  [p(-6.2, 107.1), p(-6.2, 107.2), p(-6.1, 107.2), p(-6.1, 107.1)],
];

export const AREA_CASES: { name: string; area: ServiceArea; point: LatLng; inside: boolean }[] = [
  { name: 'square centre', area: SQUARE, point: p(-6.1, 106.9), inside: true },
  { name: 'square outside', area: SQUARE, point: p(-5.9, 106.9), inside: false },
  { name: 'square edge', area: SQUARE, point: p(-6.2, 106.9), inside: true },
  { name: 'square corner', area: SQUARE, point: p(-6.0, 107.0), inside: true },
  { name: 'square just outside the edge', area: SQUARE, point: p(-6.2000001, 106.9), inside: false },
  { name: 'L body', area: L_SHAPE, point: p(-6.15, 106.95), inside: true },
  { name: 'L arm', area: L_SHAPE, point: p(-6.05, 106.85), inside: true },
  { name: 'L notch', area: L_SHAPE, point: p(-6.05, 106.95), inside: false },
  { name: 'ring one', area: TWO_RINGS, point: p(-6.15, 106.85), inside: true },
  { name: 'ring two', area: TWO_RINGS, point: p(-6.15, 107.15), inside: true },
  { name: 'gap between rings', area: TWO_RINGS, point: p(-6.15, 107.0), inside: false },
];
