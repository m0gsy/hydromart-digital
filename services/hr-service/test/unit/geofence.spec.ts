import { haversineMeters, geofenceEnabled, withinGeofence, type Geofence } from '../../src/domain/geofence';

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters(-6.2, 106.8, -6.2, 106.8)).toBeCloseTo(0, 5);
  });
  it('matches a known short distance (~111m per 0.001° lat)', () => {
    const d = haversineMeters(-6.200, 106.800, -6.201, 106.800);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(116);
  });
});

describe('geofenceEnabled', () => {
  it('needs a centre and a positive radius', () => {
    expect(geofenceEnabled({ lat: -6.2, lng: 106.8, radiusM: 150 })).toBe(true);
    expect(geofenceEnabled({ lat: null, lng: 106.8, radiusM: 150 })).toBe(false);
    expect(geofenceEnabled({ lat: -6.2, lng: 106.8, radiusM: 0 })).toBe(false);
  });
});

describe('withinGeofence', () => {
  const g: Geofence = { lat: -6.200, lng: 106.800, radiusM: 150 };

  it('allows a punch inside the radius', () => {
    const r = withinGeofence(g, -6.2005, 106.8);
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBeGreaterThan(0);
  });
  it('rejects a punch outside the radius', () => {
    const r = withinGeofence(g, -6.205, 106.8); // ~550m away
    expect(r.ok).toBe(false);
  });
  it('allows any punch when the geofence is disabled (unconfigured depot)', () => {
    expect(withinGeofence({ lat: null, lng: null, radiusM: 0 }, -1, 100)).toEqual({ ok: true, distanceM: null });
  });
});
