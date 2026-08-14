import { haversineKm } from './geo';

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
