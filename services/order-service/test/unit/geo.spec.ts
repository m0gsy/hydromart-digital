import { DepotLocation } from '../../src/application/ports/depot-directory.port';
import {
  haversineKm,
  isServiceArea,
  rerouteCounts,
  selectNearestDepot,
  withDepotChange,
} from '../../src/domain/geo';

const depot = (over: Partial<DepotLocation> & { id: string }): DepotLocation => ({
  lat: -6.9,
  lng: 107.6,
  serviceRadiusKm: 10,
  deliveryFee: 5000,
  minOrderAmount: null,
  ...over,
});

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(-6.9, 107.6, -6.9, 107.6)).toBe(0);
  });

  it('matches the known Bandung→Jakarta great-circle distance (~120km)', () => {
    const km = haversineKm(-6.9, 107.6, -6.2, 106.8);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(130);
  });
});

describe('selectNearestDepot', () => {
  it('returns null when there are no depots', () => {
    expect(selectNearestDepot(-6.9, 107.6, [])).toBeNull();
  });

  it('picks the nearest depot whose radius covers the point', () => {
    const near = depot({ id: 'near', lat: -6.91, lng: 107.61 });
    const far = depot({ id: 'far', lat: -6.2, lng: 106.8 });
    expect(selectNearestDepot(-6.9, 107.6, [far, near])?.id).toBe('near');
  });

  it('returns null when the point is outside every service radius', () => {
    const tiny = depot({ id: 'tiny', lat: -6.2, lng: 106.8, serviceRadiusKm: 1 });
    expect(selectNearestDepot(-6.9, 107.6, [tiny])).toBeNull();
  });

  it('breaks equidistant ties deterministically by depot id', () => {
    // Two depots at the exact same location → identical distance; lower id wins.
    const b = depot({ id: 'depot-b' });
    const a = depot({ id: 'depot-a' });
    expect(selectNearestDepot(-6.9, 107.6, [b, a])?.id).toBe('depot-a');
  });

  // A depot row whose coordinates or radius are missing produces NaN distances. Every NaN
  // comparison is false, so without an explicit guard `distance > radius` fails to skip it
  // and the row is elected for EVERY address on earth — silently swallowing out-of-area
  // checkouts that ORDER_OUT_OF_SERVICE_AREA exists to reject.
  it('ignores depots with a non-finite coordinate or radius', () => {
    const good = depot({ id: 'good', lat: -6.9, lng: 107.6 });
    const noCoords = depot({
      id: 'broken',
      lat: undefined as unknown as number,
      lng: undefined as unknown as number,
    });
    const noRadius = depot({ id: 'no-radius', serviceRadiusKm: undefined as unknown as number });

    expect(selectNearestDepot(-6.9, 107.6, [noCoords, good])?.id).toBe('good');
    expect(selectNearestDepot(-6.9, 107.6, [noRadius, good])?.id).toBe('good');
    // …and a broken row alone must not make a far-away address look serviceable.
    expect(selectNearestDepot(-8.65, 115.22, [noCoords])).toBeNull();
  });

  describe('with a drawn service area', () => {
    // 0.1 x 0.1 degree square centred on the depot at (-6.9, 107.6).
    const square = [
      [
        { lat: -6.95, lng: 107.55 },
        { lat: -6.95, lng: 107.65 },
        { lat: -6.85, lng: 107.65 },
        { lat: -6.85, lng: 107.55 },
      ],
    ];

    it('serves a point inside the polygon even when it is past the radius', () => {
      const d = depot({ id: 'poly', serviceRadiusKm: 1, serviceArea: square });
      // ~6.1 km from the depot, inside the square.
      expect(haversineKm(-6.9, 107.6, -6.9, 107.645)).toBeGreaterThan(1);
      expect(selectNearestDepot(-6.9, 107.645, [d])?.id).toBe('poly');
    });

    it('refuses a point outside the polygon however large the radius', () => {
      const d = depot({ id: 'poly', serviceRadiusKm: 500, serviceArea: square });
      expect(selectNearestDepot(-6.9, 107.7, [d])).toBeNull();
    });

    it('still ranks the depots that serve the point by distance', () => {
      const wide = depot({ id: 'wide', lat: -6.9, lng: 107.55, serviceArea: square });
      const near = depot({ id: 'near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10 });
      expect(selectNearestDepot(-6.9, 107.6, [wide, near])?.id).toBe('near');
    });

    it('does not need a radius to route by area, but still needs coordinates to rank', () => {
      const noRadius = depot({
        id: 'poly',
        serviceRadiusKm: undefined as unknown as number,
        serviceArea: square,
      });
      expect(selectNearestDepot(-6.9, 107.6, [noRadius])?.id).toBe('poly');
      const noCoords = depot({
        id: 'broken',
        lat: undefined as unknown as number,
        serviceArea: square,
      });
      expect(selectNearestDepot(-6.9, 107.6, [noCoords])).toBeNull();
    });

    it('treats an empty or null area as radius routing', () => {
      expect(selectNearestDepot(-6.9, 107.6, [depot({ id: 'a', serviceArea: [] })])?.id).toBe('a');
      expect(selectNearestDepot(-6.9, 107.6, [depot({ id: 'b', serviceArea: null })])?.id).toBe(
        'b',
      );
      expect(selectNearestDepot(-8.65, 115.22, [depot({ id: 'c', serviceArea: null })])).toBeNull();
    });
  });
});

/*
 * P3-3. 0.01° of latitude is ~1.11 km. Depot a sits at -6.90 (5 km), b at -7.00 (8 km):
 *   -6.90 → a only · -6.93 → both, a nearer · -6.86 → a only · -6.95 → b only
 */
describe('rerouteCounts (P3-3 dry run)', () => {
  const a = depot({ id: 'a', lat: -6.9, lng: 107.6, serviceRadiusKm: 5 });
  const b = depot({ id: 'b', lat: -7.0, lng: 107.6, serviceRadiusKm: 8 });
  const pins = [-6.9, -6.93, -6.86, -6.95].map((lat) => ({ lat, lng: 107.6 }));

  it('counts who moves and who is left unserved when a depot is suspended', () => {
    const after = withDepotChange([a, b], { depotId: 'a', active: false });
    expect(rerouteCounts(pins, [a, b], after)).toEqual({
      affected: 3,
      unserved: 2,
      moves: [
        { fromDepotId: 'a', toDepotId: null, count: 2 },
        { fromDepotId: 'a', toDepotId: 'b', count: 1 },
      ],
    });
  });

  it('counts a shrunk radius, and nothing for a change that moves nobody', () => {
    const smaller = withDepotChange([a, b], { depotId: 'b', serviceRadiusKm: 3 });
    expect(rerouteCounts(pins, [a, b], smaller)).toEqual({
      affected: 1,
      unserved: 1,
      moves: [{ fromDepotId: 'b', toDepotId: null, count: 1 }],
    });
    const same = withDepotChange([a, b], { depotId: 'b', lat: -7.0, lng: 107.6 });
    expect(rerouteCounts(pins, [a, b], same)).toEqual({ affected: 0, unserved: 0, moves: [] });
  });

  it('counts a moved depot: its pins go to the neighbour, the new street comes to it', () => {
    // a moves 10 km north: -6.90/-6.86 still a? -6.86 is 4.4 km from -6.82, -6.90 is 8.9 km.
    const moved = withDepotChange([a, b], { depotId: 'a', lat: -6.82, lng: 107.6 });
    const r = rerouteCounts(pins, [a, b], moved);
    expect(r.moves).toEqual(
      expect.arrayContaining([
        { fromDepotId: 'a', toDepotId: null, count: 1 },
        { fromDepotId: 'a', toDepotId: 'b', count: 1 },
      ]),
    );
    expect(r).toMatchObject({ affected: 2, unserved: 1 });
  });

  it('counts a pin nobody served that a grown radius now reaches', () => {
    const outside = [{ lat: -7.15, lng: 107.6 }]; // 16.7 km from b, 27.8 from a
    const grown = withDepotChange([a, b], { depotId: 'b', serviceRadiusKm: 20 });
    expect(rerouteCounts(outside, [a, b], grown)).toEqual({
      affected: 1,
      unserved: 0,
      moves: [{ fromDepotId: null, toDepotId: 'b', count: 1 }],
    });
  });

  it('keeps a drawn area deciding: a radius edit moves nobody it covers', () => {
    const square = [
      [
        { lat: -7.0, lng: 107.5 },
        { lat: -7.0, lng: 107.7 },
        { lat: -6.8, lng: 107.7 },
        { lat: -6.8, lng: 107.5 },
      ],
    ];
    const drawn = depot({ id: 'c', lat: -6.9, lng: 107.6, serviceRadiusKm: 5, serviceArea: square });
    const after = withDepotChange([drawn], { depotId: 'c', serviceRadiusKm: 0.001 });
    expect(rerouteCounts(pins, [drawn], after).affected).toBe(0);
    // An edit to another depot leaves this one exactly as it was.
    expect(withDepotChange([drawn], { depotId: 'other', serviceRadiusKm: 1 })).toEqual([drawn]);
  });
});

describe('a redrawn area in the dry run (P3-4)', () => {
  const pins = [{ lat: -6.9, lng: 107.6 }];
  const square = (s: number) => [
    [
      { lat: -6.9 - s, lng: 107.6 - s },
      { lat: -6.9 - s, lng: 107.6 + s },
      { lat: -6.9 + s, lng: 107.6 + s },
      { lat: -6.9 + s, lng: 107.6 - s },
    ],
  ];
  const a = depot({ id: 'a', lat: -6.9, lng: 107.6, serviceRadiusKm: 5, serviceArea: square(0.1) });

  it('counts the pins a smaller area leaves out, and none when the area is cleared to a radius that covers them', () => {
    const smaller = withDepotChange([a], { depotId: 'a', serviceArea: square(0.1).map((r) => r.map((p) => ({ lat: p.lat + 0.5, lng: p.lng }))) });
    expect(rerouteCounts(pins, [a], smaller)).toMatchObject({ affected: 1, unserved: 1 });
    const cleared = withDepotChange([a], { depotId: 'a', serviceArea: null });
    expect(cleared[0]!.serviceArea).toBeNull();
    expect(rerouteCounts(pins, [a], cleared).affected).toBe(0);
  });

  it('knows an area from anything else', () => {
    expect(isServiceArea(square(0.1))).toBe(true);
    expect(isServiceArea([[{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]])).toBe(false);
    expect(isServiceArea([[{ lat: 91, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }]])).toBe(false);
    expect(isServiceArea([[null, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }]])).toBe(false);
    expect(isServiceArea(['x'])).toBe(false);
    expect(isServiceArea({})).toBe(false);
  });
});
