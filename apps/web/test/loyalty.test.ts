import { describe, expect, it } from 'vitest';

import { tierProgress } from '@/lib/loyalty';
import type { TierBenefit } from '@/lib/types';

const LADDER: TierBenefit[] = [
  { tier: 'REGULAR', threshold: 0, discountRate: 0 },
  { tier: 'SILVER', threshold: 1000, discountRate: 0.02 },
  { tier: 'GOLD', threshold: 5000, discountRate: 0.05 },
  { tier: 'PLATINUM', threshold: 15000, discountRate: 0.08 },
];

describe('tierProgress', () => {
  it('points to the next tier and the fraction of the way there', () => {
    const p = tierProgress(LADDER, 3000);
    expect(p.next?.tier).toBe('GOLD');
    expect(p.pointsToNext).toBe(2000);
    // From SILVER (1000) toward GOLD (5000): 2000/4000 = 0.5
    expect(p.fraction).toBeCloseTo(0.5);
  });

  it('measures progress from zero before the first rung', () => {
    const p = tierProgress(LADDER, 500);
    expect(p.next?.tier).toBe('SILVER');
    expect(p.pointsToNext).toBe(500);
    expect(p.fraction).toBeCloseTo(0.5);
  });

  it('reports the top tier as finished', () => {
    const p = tierProgress(LADDER, 20000);
    expect(p.next).toBeNull();
    expect(p.pointsToNext).toBe(0);
    expect(p.fraction).toBe(1);
  });

  it('handles an unsorted ladder', () => {
    const p = tierProgress([...LADDER].reverse(), 3000);
    expect(p.next?.tier).toBe('GOLD');
  });
});
