import { MembershipTier, TierBenefit, benefitFor, tierFor } from '../../src/domain/membership';
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

  it('judges against a supplied ladder, so a depot can move the rungs', () => {
    const strict: TierBenefit[] = [
      { tier: MembershipTier.REGULAR, threshold: 0, discountRate: 0 },
      { tier: MembershipTier.SILVER, threshold: 4000, discountRate: 0.01 },
      { tier: MembershipTier.GOLD, threshold: 9000, discountRate: 0.03 },
      { tier: MembershipTier.PLATINUM, threshold: 30000, discountRate: 0.04 },
    ];
    // 5000 points is GOLD on the default ladder but only SILVER on this one.
    expect(tierFor(5000, strict)).toBe(MembershipTier.SILVER);
    expect(benefitFor(MembershipTier.SILVER, strict).discountRate).toBe(0.01);
  });

  it('picks the highest rung reached even when the ladder is stored out of order', () => {
    // Six independently-editable settings can produce this; taking the last match
    // in stored order would hand a 6000-point customer SILVER instead of GOLD.
    const jumbled: TierBenefit[] = [
      { tier: MembershipTier.PLATINUM, threshold: 15000, discountRate: 0.08 },
      { tier: MembershipTier.GOLD, threshold: 5000, discountRate: 0.05 },
      { tier: MembershipTier.REGULAR, threshold: 0, discountRate: 0 },
      { tier: MembershipTier.SILVER, threshold: 1000, discountRate: 0.02 },
    ];
    expect(tierFor(6000, jumbled)).toBe(MembershipTier.GOLD);
    expect(tierFor(0, jumbled)).toBe(MembershipTier.REGULAR);
  });

  it('falls back to the default table when the supplied ladder is empty', () => {
    expect(tierFor(9999, [])).toBe(MembershipTier.REGULAR);
    expect(benefitFor(MembershipTier.GOLD, []).discountRate).toBe(0);
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
