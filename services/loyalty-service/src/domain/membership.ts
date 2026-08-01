// Membership tiers and their benefits (PRD FR-014 membership status, FR-032 membership
// discount). Thresholds are cumulative lifetime points. Exact numbers are "company
// policy" (not fixed by the PRD); these are the documented defaults.
//
// The table below is the DEFAULT ladder. A depot may override any rung (threshold and
// rate) through per-depot settings, so every function here takes the table to judge
// against; callers that have a depot pass that depot's table. See
// LoyaltyConfigService.tierBenefits.

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

/**
 * Highest tier whose threshold is met by the given lifetime points.
 *
 * Sorts first: the constant is written ascending, but a per-depot table is assembled from
 * six independently-editable settings, and nothing stops an operator from setting GOLD's
 * threshold below SILVER's. Reading such a table in stored order would hand out the last
 * rung that happened to match rather than the best one.
 */
export function tierFor(
  lifetimePoints: number,
  benefits: readonly TierBenefit[] = TIER_BENEFITS,
): MembershipTier {
  let result = MembershipTier.REGULAR;
  let best = -1;
  for (const benefit of benefits) {
    if (lifetimePoints >= benefit.threshold && benefit.threshold > best) {
      best = benefit.threshold;
      result = benefit.tier;
    }
  }
  return result;
}

export function benefitFor(
  tier: MembershipTier,
  benefits: readonly TierBenefit[] = TIER_BENEFITS,
): TierBenefit {
  const found = benefits.find((b) => b.tier === tier);
  // Every enum member has a row; the fallback keeps the return type non-optional.
  return found ?? benefits[0] ?? TIER_BENEFITS[0];
}
