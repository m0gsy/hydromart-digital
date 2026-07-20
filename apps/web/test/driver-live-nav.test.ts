import { describe, expect, it } from 'vitest';

import { etaMinutes, haversineKm, shouldPing } from '@/components/driver/live-nav';

describe('driver live-nav', () => {
  it('haversineKm ~0 for identical points and ~1.1km for 0.01deg lat', () => {
    expect(haversineKm(-6.9, 107.6, -6.9, 107.6)).toBeCloseTo(0, 5);
    // 0.01 degree of latitude ≈ 1.11 km anywhere on Earth.
    expect(haversineKm(-6.9, 107.6, -6.89, 107.6)).toBeCloseTo(1.11, 1);
  });

  it('etaMinutes never returns below 1 and scales with distance', () => {
    expect(etaMinutes(0)).toBe(1);
    expect(etaMinutes(11)).toBeGreaterThan(etaMinutes(1));
  });

  it('shouldPing gates on the 15s interval', () => {
    expect(shouldPing(null, 1_000)).toBe(true); // first ping always fires
    expect(shouldPing(1_000, 1_000 + 14_999)).toBe(false);
    expect(shouldPing(1_000, 1_000 + 15_000)).toBe(true);
  });
});
