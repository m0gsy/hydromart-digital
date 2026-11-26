import {
  depotServes,
  LatLng,
  pointInServiceArea,
  readServiceArea,
  ServiceArea,
  servingDepot,
  ServingDepot,
} from './service-area';
import { haversineKm } from './geo';

const p = (lat: number, lng: number): LatLng => ({ lat, lng });

// A 0.2 x 0.2 degree square.
const SQUARE: ServiceArea = [[p(-6.2, 106.8), p(-6.2, 107.0), p(-6.0, 107.0), p(-6.0, 106.8)]];
// An "L": the notch (lat > -6.1, lng > 106.9) is outside.
const L_SHAPE: ServiceArea = [
  [p(-6.2, 106.8), p(-6.2, 107.0), p(-6.1, 107.0), p(-6.1, 106.9), p(-6.0, 106.9), p(-6.0, 106.8)],
];
// Two separate squares; the gap between them is not served.
const TWO_RINGS: ServiceArea = [
  [p(-6.2, 106.8), p(-6.2, 106.9), p(-6.1, 106.9), p(-6.1, 106.8)],
  [p(-6.2, 107.1), p(-6.2, 107.2), p(-6.1, 107.2), p(-6.1, 107.1)],
];

describe('pointInServiceArea', () => {
  it.each([
    ['square centre', SQUARE, p(-6.1, 106.9), true],
    ['square outside', SQUARE, p(-5.9, 106.9), false],
    ['square edge', SQUARE, p(-6.2, 106.9), true],
    ['square corner', SQUARE, p(-6.0, 107.0), true],
    ['square just outside the edge', SQUARE, p(-6.2000001, 106.9), false],
    ['L body', L_SHAPE, p(-6.15, 106.95), true],
    ['L arm', L_SHAPE, p(-6.05, 106.85), true],
    ['L notch', L_SHAPE, p(-6.05, 106.95), false],
    ['L just outside the concave corner', L_SHAPE, p(-6.05, 106.9000001), false],
    ['ring one', TWO_RINGS, p(-6.15, 106.85), true],
    ['ring two', TWO_RINGS, p(-6.15, 107.15), true],
    ['gap between rings', TWO_RINGS, p(-6.15, 107.0), false],
  ])('%s', (_name, area, point, inside) => {
    expect(pointInServiceArea(point, area)).toBe(inside);
  });

  it('is the same either way round a ring is wound', () => {
    const reversed: ServiceArea = [[...(SQUARE[0] as LatLng[])].reverse()];
    expect(pointInServiceArea(p(-6.1, 106.9), reversed)).toBe(true);
    expect(pointInServiceArea(p(-5.9, 106.9), reversed)).toBe(false);
  });

  it('contains nothing when there are no rings', () => {
    expect(pointInServiceArea(p(0, 0), [])).toBe(false);
  });
});

describe('readServiceArea', () => {
  it('passes a well-formed area through', () => {
    expect(readServiceArea(SQUARE)).toEqual(SQUARE);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'x'],
    ['an empty list', []],
    ['a ring that is not a list', ['x']],
    ['a ring of two points', [[p(0, 0), p(1, 1)]]],
    ['a point with a string coordinate', [[p(0, 0), p(1, 1), { lat: '1', lng: 2 }]]],
    ['a point that is null', [[p(0, 0), p(1, 1), null]]],
    ['a NaN coordinate', [[p(0, 0), p(1, 1), p(NaN, 2)]]],
    ['one good ring and one bad', [SQUARE[0], [p(0, 0)]]],
  ])('reads %s as no drawn area', (_name, value) => {
    expect(readServiceArea(value)).toBeNull();
  });

  it('drops unknown properties on points', () => {
    expect(readServiceArea([[{ lat: 0, lng: 0, x: 1 }, p(0, 1), p(1, 1)]])).toEqual([
      [p(0, 0), p(0, 1), p(1, 1)],
    ]);
  });
});

const dep = (
  id: string,
  lat: number,
  lng: number,
  r: number | null,
  area?: ServiceArea | null,
): ServingDepot => ({
  id,
  lat,
  lng,
  serviceRadiusKm: r,
  serviceArea: area,
});

describe('depotServes', () => {
  const here = p(-6.1, 106.9);
  it('radius decides without an area, edge included', () => {
    const km = haversineKm(here.lat, here.lng, -6.1, 106.95);
    expect(depotServes(here, dep('a', -6.1, 106.95, km))).toBe(true);
    expect(depotServes(here, dep('a', -6.1, 106.95, km - 0.001))).toBe(false);
  });
  it('a drawn area wins over the radius, edge included', () => {
    expect(depotServes(p(-6.2, 106.9), dep('a', -6.1, 106.9, 0.1, SQUARE))).toBe(true);
    expect(depotServes(p(-5.9, 106.9), dep('a', -6.1, 106.9, 999, SQUARE))).toBe(false);
  });
  it('an empty area falls back to the radius', () => {
    expect(depotServes(here, dep('a', -6.1, 106.9, 1, []))).toBe(true);
  });
  it.each([
    ['null radius', dep('a', -6.1, 106.9, null)],
    ['NaN radius', dep('a', -6.1, 106.9, NaN)],
    ['NaN lat', dep('a', NaN, 106.9, 50)],
    ['NaN lat with an area', dep('a', NaN, 106.9, 50, SQUARE)],
  ])('%s never serves', (_n, d) => {
    expect(depotServes(here, d)).toBe(false);
  });
});

describe('servingDepot', () => {
  const here = p(-6.1, 106.9);
  it('picks the nearest serving depot', () => {
    const far = dep('far', -6.1, 106.95, 50);
    const near = dep('near', -6.1, 106.91, 50);
    expect(servingDepot(here, [far, near])).toBe(near);
  });
  it('ignores non-serving and garbage rows, null when none serves', () => {
    const bad = dep('bad', NaN, NaN, NaN);
    const out = dep('out', -6.1, 107.5, 1);
    expect(servingDepot(here, [bad, out])).toBeNull();
    expect(servingDepot(here, [])).toBeNull();
    expect(servingDepot(here, [bad, dep('ok', -6.1, 106.91, 5)])?.id).toBe('ok');
  });
  it('breaks a distance tie by id, whatever the order', () => {
    const a = dep('a', -6.1, 106.95, 50);
    const b = dep('b', -6.1, 106.95, 50);
    expect(servingDepot(here, [b, a])).toBe(a);
    expect(servingDepot(here, [a, b])).toBe(a);
  });
});
