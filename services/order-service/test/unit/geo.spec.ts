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
});
