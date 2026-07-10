import { MembershipTier, benefitFor, tierFor } from '../../src/domain/membership';
import { expiryFrom, pointsForOrder } from '../../src/domain/points';

describe('membership tiers', () => {
  it('maps lifetime points to the highest tier reached', () => {
    expect(tierFor(0)).toBe(MembershipTier.REGULAR);
    expect(tierFor(999)).toBe(MembershipTier.REGULAR);
    expect(tierFor(1000)).toBe(MembershipTier.SILVER);
    expect(tierFor(4999)).toBe(MembershipTier.SILVER);
    expect(tierFor(5000)).toBe(MembershipTier.GOLD);
    expect(tierFor(15000)).toBe(MembershipTier.PLATINUM);
    expect(tierFor(999999)).toBe(MembershipTier.PLATINUM);
  });

  it('exposes a discount rate per tier (FR-032)', () => {
    expect(benefitFor(MembershipTier.REGULAR).discountRate).toBe(0);
    expect(benefitFor(MembershipTier.GOLD).discountRate).toBe(0.05);
    expect(benefitFor(MembershipTier.PLATINUM).discountRate).toBe(0.08);
  });
});

describe('points math', () => {
  it('earns one point per rate-rupiah of subtotal, floored (BR-013)', () => {
    expect(pointsForOrder(60000, 1000)).toBe(60);
    expect(pointsForOrder(60999, 1000)).toBe(60);
    expect(pointsForOrder(999, 1000)).toBe(0);
  });

  it('earns nothing for a non-positive subtotal or rate', () => {
    expect(pointsForOrder(0, 1000)).toBe(0);
    expect(pointsForOrder(-5, 1000)).toBe(0);
    expect(pointsForOrder(5000, 0)).toBe(0);
  });

  it('computes an expiry a number of months out (BR-014)', () => {
    const base = new Date('2026-01-15T00:00:00.000Z');
    expect(expiryFrom(base, 12).getUTCFullYear()).toBe(2027);
    expect(expiryFrom(base, 12).getUTCMonth()).toBe(0);
  });
});
