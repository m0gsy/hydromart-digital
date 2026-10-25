import { describe, expect, it } from 'vitest';

import { discountShare, formatShare } from '@/lib/insight/promo';

describe('discountShare', () => {
  it('is the discount over the value of the same orders', () => {
    expect(discountShare(240_000, 2_400_000)).toBeCloseTo(0.1);
  });

  it('has no share when the value is unknown or zero, never 0% or infinity', () => {
    expect(discountShare(5_000, null)).toBeNull();
    expect(discountShare(5_000, 0)).toBeNull();
    expect(discountShare(0, 100_000)).toBe(0);
  });
});

describe('formatShare', () => {
  it('prints one decimal with a comma', () => {
    expect(formatShare(0.1)).toBe('10,0%');
    expect(formatShare(0.0426)).toBe('4,3%');
    expect(formatShare(0)).toBe('0,0%');
  });
});
