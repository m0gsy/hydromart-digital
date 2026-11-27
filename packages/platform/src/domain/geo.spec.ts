import {
  APPROXIMATE_ACCURACY_M,
  geofenceEnabled,
  gridCell1km,
  gridCellCenter,
  haversineKm,
  haversineMeters,
  isApproximateFix,
  onCoarseGrid,
  withinGeofence,
  type Geofence,
} from './geo';

// Fixes stored on punches from phones on Android "Perkiraan" (approximate location), and a
// real GPS fix taken at the same depot for comparison.
const GALAXY_COARSE = [-6.27027027027027, 106.9642098165971] as const;
const PEKAYON_COARSE = [-6.27027027027027, 106.9823362714042] as const;
// 2026-11-25: Muhammad Rouf's punch, 1387 m from Depot Jatibening while he stood inside it.
const JATIBENING_COARSE = [-6.27027027027027, 106.94608336179] as const;
const REAL_GPS = [-6.261605, 106.937094] as const;

/**
 * Shared because two services ask it: hr-service refuses an attendance punch on it, and
 * delivery-service names it when a courier's shift check-in is refused (2026-11-25).
 */
describe('onCoarseGrid', () => {
  it("finds the refused punches on Android's 2 km grid", () => {
    expect(onCoarseGrid(...GALAXY_COARSE)).toBe(true);
    expect(onCoarseGrid(...PEKAYON_COARSE)).toBe(true);
    expect(onCoarseGrid(...JATIBENING_COARSE)).toBe(true);
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

/**
 * Shared because two services now ask the same question: order-service decides at checkout
 * whether an address is inside a depot's service radius, and customer-service prints that
 * verdict on the depot CRM card. Two implementations would drift, and the failure would
 * look like a data problem — an address the shop accepted showing as out-of-area to staff.
 */
describe('haversineKm', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(-6.9, 107.6, -6.9, 107.6)).toBe(0);
  });

  it('measures a short north-south hop in km', () => {
    // 0.01° of latitude is ~1.11 km anywhere on the globe.
    expect(haversineKm(-6.9, 107.6, -6.89, 107.6)).toBeCloseTo(1.11, 2);
  });

  it('is symmetric', () => {
    const a = haversineKm(-6.9, 107.6, -7.25, 112.75);
    const b = haversineKm(-7.25, 112.75, -6.9, 107.6);
    expect(a).toBeCloseTo(b, 10);
  });

  it('measures Bandung to Surabaya to within a few km of the known distance', () => {
    expect(haversineKm(-6.9175, 107.6191, -7.2575, 112.7521)).toBeCloseTo(570, -1);
  });

  // Longitude degrees shrink toward the poles; a formula that treated them as flat would
  // report the same distance at the equator and at 60° north.
  it('accounts for longitude converging away from the equator', () => {
    const atEquator = haversineKm(0, 0, 0, 1);
    const atSixty = haversineKm(60, 0, 60, 1);
    expect(atSixty).toBeLessThan(atEquator);
    expect(atSixty / atEquator).toBeCloseTo(0.5, 2); // cos(60°)
  });
});

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters(-6.2, 106.8, -6.2, 106.8)).toBeCloseTo(0, 5);
  });
  it('matches a known short distance (~111m per 0.001 degree lat)', () => {
    const d = haversineMeters(-6.2, 106.8, -6.201, 106.8);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(116);
  });
});

describe('geofenceEnabled', () => {
  it('needs a centre and a positive radius', () => {
    expect(geofenceEnabled({ lat: -6.2, lng: 106.8, radiusM: 150 })).toBe(true);
    expect(geofenceEnabled({ lat: null, lng: 106.8, radiusM: 150 })).toBe(false);
    expect(geofenceEnabled({ lat: -6.2, lng: null, radiusM: 150 })).toBe(false);
    expect(geofenceEnabled({ lat: -6.2, lng: 106.8, radiusM: 0 })).toBe(false);
    expect(geofenceEnabled({ lat: Number.NaN, lng: 106.8, radiusM: 150 })).toBe(false);
    expect(geofenceEnabled({ lat: -6.2, lng: Number.NaN, radiusM: 150 })).toBe(false);
  });
});

describe('withinGeofence', () => {
  const g: Geofence = { lat: -6.2, lng: 106.8, radiusM: 150 };

  it('allows a point inside the radius', () => {
    const r = withinGeofence(g, -6.2005, 106.8);
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBeGreaterThan(0);
  });
  it('rejects a point outside the radius', () => {
    expect(withinGeofence(g, -6.205, 106.8).ok).toBe(false);
  });
  it('allows any point when the geofence is disabled', () => {
    expect(withinGeofence({ lat: null, lng: null, radiusM: 0 }, -1, 100)).toEqual({
      ok: true,
      distanceM: null,
    });
  });
});

describe('gridCell1km', () => {
  it('names the cell of a point, negative coordinates floor away from zero', () => {
    expect(gridCell1km(-6.1754, 106.8272)).toBe('-687:11869');
    expect(gridCell1km(1, 1)).toBe('111:111');
  });
  it('two points about 1 km apart land in different cells, nearby points in the same one', () => {
    expect(gridCell1km(-6.1754, 106.8272)).toBe(gridCell1km(-6.1756, 106.8274));
    expect(gridCell1km(-6.1754, 106.8272)).not.toBe(gridCell1km(-6.1754, 106.8372));
  });
  it('a point exactly on a cell edge belongs to the cell that starts there', () => {
    expect(gridCell1km(0.009 * 3, 0)).toBe('3:0');
    expect(gridCell1km(-0.0001, -0.0001)).toBe('-1:-1');
  });
  it('the centre of a cell is in that cell, about 0.5 km from its edges', () => {
    for (const cell of ['-687:11869', '3:0', '-1:-1']) {
      const c = gridCellCenter(cell);
      expect(gridCell1km(c.lat, c.lng)).toBe(cell);
    }
    expect(gridCellCenter('0:0')).toEqual({ lat: 0.0045, lng: 0.0045 });
  });
});
