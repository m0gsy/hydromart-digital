import { describe, expect, it } from 'vitest';

import { effectiveRate, memberPrice } from '@/lib/member';
import type { LoyaltyAccount, TierBenefit } from '@/lib/types';

const tiers: TierBenefit[] = [
  { tier: 'REGULAR', threshold: 0, discountRate: 0 },
  { tier: 'SILVER', threshold: 1000, discountRate: 0.02 },
  { tier: 'GOLD', threshold: 5000, discountRate: 0.05 },
];

const account = (rate: number): LoyaltyAccount => ({
  customerId: 'c1',
  tier: 'GOLD',
  pointsBalance: 0,
  lifetimePoints: 0,
  discountRate: rate,
});

describe('effectiveRate', () => {
  it('uses the signed-in account rate when positive', () => {
    expect(effectiveRate(account(0.05), tiers)).toBe(0.05);
  });

  it('falls back to the lowest positive tier rate for guests / regular members', () => {
    expect(effectiveRate(null, tiers)).toBe(0.02);
    expect(effectiveRate(account(0), tiers)).toBe(0.02);
  });

  it('is 0 when no positive tier exists (hide the chip)', () => {
    expect(effectiveRate(null, [{ tier: 'REGULAR', threshold: 0, discountRate: 0 }])).toBe(0);
    expect(effectiveRate(null, null)).toBe(0);
  });
});

describe('memberPrice', () => {
  it('applies the rate and rounds to whole rupiah', () => {
    expect(memberPrice(8000, 0.02)).toBe(7840);
    expect(memberPrice(8000, 0.05)).toBe(7600);
    expect(memberPrice(8000, 0)).toBe(8000);
    expect(memberPrice(9999, 0.05)).toBe(9499); // 9499.05 → 9499
  });
});
