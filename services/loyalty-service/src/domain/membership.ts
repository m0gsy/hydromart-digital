// Membership tiers and their benefits (PRD FR-014 membership status, FR-032 membership
// discount). Thresholds are cumulative lifetime points. Exact numbers are "company
// policy" (not fixed by the PRD); these are the documented defaults.
//
// ponytail: tier table is a domain constant, not env-configurable. It changes rarely
// and lives in one place; promote to config only if marketing needs to tune it live.

export enum MembershipTier {
  REGULAR = 'REGULAR',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
}

export interface TierBenefit {
  tier: MembershipTier;
  /** Minimum cumulative lifetime points to hold this tier. */
  threshold: number;
  /** Fraction off the order subtotal this tier earns at checkout (FR-032). */
  discountRate: number;
}

// Ordered ascending by threshold.
export const TIER_BENEFITS: readonly TierBenefit[] = [
  { tier: MembershipTier.REGULAR, threshold: 0, discountRate: 0 },
  { tier: MembershipTier.SILVER, threshold: 1000, discountRate: 0.02 },
  { tier: MembershipTier.GOLD, threshold: 5000, discountRate: 0.05 },
  { tier: MembershipTier.PLATINUM, threshold: 15000, discountRate: 0.08 },
] as const;

/** Highest tier whose threshold is met by the given lifetime points. */
export function tierFor(lifetimePoints: number): MembershipTier {
  let result = MembershipTier.REGULAR;
  for (const benefit of TIER_BENEFITS) {
    if (lifetimePoints >= benefit.threshold) result = benefit.tier;
  }
  return result;
}

export function benefitFor(tier: MembershipTier): TierBenefit {
  const found = TIER_BENEFITS.find((b) => b.tier === tier);
  // Every enum member has a row; the fallback keeps the return type non-optional.
  return found ?? TIER_BENEFITS[0];
}
