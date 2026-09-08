import { describe, expect, it } from 'vitest';

import { etaMinutes, haversineKm, shouldPing } from '@/components/driver/live-nav';

describe('driver live-nav', () => {
  it('haversineKm ~0 for identical points and ~1.1km for 0.01deg lat', () => {
    expect(haversineKm(-6.9, 107.6, -6.9, 107.6)).toBeCloseTo(0, 5);
    // 0.01 degree of latitude ≈ 1.11 km anywhere on Earth.
    expect(haversineKm(-6.9, 107.6, -6.89, 107.6)).toBeCloseTo(1.11, 1);
  });

  it('etaMinutes never returns below 1 and scales with distance', () => {
    expect(etaMinutes(0, 18)).toBe(1);
    expect(etaMinutes(11, 18)).toBeGreaterThan(etaMinutes(1, 18));
  });

  /*
   * CA-4-39. The speed used to be a constant 22 in this file while the ETA the CUSTOMER
   * sees comes from `DELIVERY_URBAN_SPEED_KMPH` — default 18, tunable per depot. Two
   * speeds for one journey, differing by about a fifth, and a depot that tuned its number
   * moved only one of the two screens.
   */
  it('answers the depot speed it is given, not a constant of its own', () => {
    // 9 km at 18 km/h is half an hour; the same 9 km at 22 was 25 minutes.
    expect(etaMinutes(9, 18)).toBe(30);
    expect(etaMinutes(9, 36)).toBe(15);
    // A depot that halves its assumed speed doubles every ETA on the courier's screen.
    expect(etaMinutes(9, 9)).toBe(etaMinutes(9, 18) * 2);
  });

  it('shouldPing gates on the 15s interval', () => {
    expect(shouldPing(null, 1_000)).toBe(true); // first ping always fires
    expect(shouldPing(1_000, 1_000 + 14_999)).toBe(false);
    expect(shouldPing(1_000, 1_000 + 15_000)).toBe(true);
  });
});
