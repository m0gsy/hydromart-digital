import {
  APPROXIMATE_ACCURACY_M,
  haversineMeters,
  geofenceEnabled,
  isApproximateFix,
  onCoarseGrid,
  withinGeofence,
  type Geofence,
} from '../../src/domain/geofence';

// The fixes stored on the refused punches of 2026-11-21 (Android "Perkiraan"), and a real
// GPS fix taken at the same depot for comparison.
const GALAXY_COARSE = [-6.27027027027027, 106.9642098165971] as const;
const PEKAYON_COARSE = [-6.27027027027027, 106.9823362714042] as const;
const REAL_GPS = [-6.261605, 106.937094] as const;

describe('onCoarseGrid', () => {
  it("finds the refused punches on Android's 2 km grid", () => {
    expect(onCoarseGrid(...GALAXY_COARSE)).toBe(true);
    expect(onCoarseGrid(...PEKAYON_COARSE)).toBe(true);
  });
  it('does not mistake a real fix, or a point on only one axis of the grid, for one', () => {
    expect(onCoarseGrid(...REAL_GPS)).toBe(false);
    expect(onCoarseGrid(-6.2, 106.8)).toBe(false);
    expect(onCoarseGrid(GALAXY_COARSE[0], 106.95)).toBe(false);
  });
});

describe('isApproximateFix', () => {
  it('trusts the phone when it says its fix is loose', () => {
    expect(isApproximateFix(...REAL_GPS, APPROXIMATE_ACCURACY_M)).toBe(true);
    expect(isApproximateFix(...REAL_GPS, 2000)).toBe(true);
    expect(isApproximateFix(...REAL_GPS, 999)).toBe(false);
  });
  it('reads the grid when the phone says nothing usable', () => {
    expect(isApproximateFix(...GALAXY_COARSE)).toBe(true);
    expect(isApproximateFix(...GALAXY_COARSE, null)).toBe(true);
    expect(isApproximateFix(...REAL_GPS)).toBe(false);
    expect(isApproximateFix(...REAL_GPS, Number.NaN)).toBe(false);
  });
});

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters(-6.2, 106.8, -6.2, 106.8)).toBeCloseTo(0, 5);
  });
  it('matches a known short distance (~111m per 0.001° lat)', () => {
    const d = haversineMeters(-6.2, 106.8, -6.201, 106.8);
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
  const g: Geofence = { lat: -6.2, lng: 106.8, radiusM: 150 };

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
    expect(withinGeofence({ lat: null, lng: null, radiusM: 0 }, -1, 100)).toEqual({
      ok: true,
      distanceM: null,
    });
  });
});
