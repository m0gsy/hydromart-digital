import { DepotLocation } from '../../src/application/ports/depot-directory.port';
import { haversineKm, selectNearestDepot } from '../../src/domain/geo';

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
