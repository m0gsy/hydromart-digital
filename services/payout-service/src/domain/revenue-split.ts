import { InvalidRevenueOwnersError } from './errors';

/** One owner of a franchise depot and the share of its revenue they take. */
export interface RevenueOwner {
  ownerId: string;
  /** Percent, at most two decimals (33.34 / 33.33 / 33.33). */
  sharePct: number;
  isPrimary: boolean;
}

/** Hundredths of a percent, so 33.33 * 3 is an integer comparison and cannot drift. */
const hundredths = (pct: number): number => Math.round(pct * 100);

/**
 * The owners a revenue push names, checked: non-empty, unique, shares summing to exactly 100
 * and exactly one primary. Anything else would credit more or less than the order earned.
 */
export function assertRevenueOwners(owners: readonly RevenueOwner[]): RevenueOwner[] {
  if (owners.length === 0) throw new InvalidRevenueOwnersError('no owner to credit');
  if (new Set(owners.map((o) => o.ownerId)).size !== owners.length) {
    throw new InvalidRevenueOwnersError('an owner is listed twice');
  }
  const total = owners.reduce((sum, o) => sum + hundredths(o.sharePct), 0);
  if (total !== 10_000 || owners.some((o) => hundredths(o.sharePct) <= 0)) {
    throw new InvalidRevenueOwnersError('shares must be positive and add up to 100%');
  }
  if (owners.filter((o) => o.isPrimary).length !== 1) {
    throw new InvalidRevenueOwnersError('exactly one owner must be the primary');
  }
  return [...owners];
}

/**
 * Splits whole rupiah between owners so the parts add up to the total EXACTLY.
 *
 * Largest-remainder: each owner gets the floor of their exact share, and the rupiah left over
 * go one each to the biggest fractional parts. Ties go to the primary owner, then to the
 * lower ownerId, so a retried push computes the identical split. Rounding each share on its
 * own would drift from the order total by a few rupiah a sale, and the books would stop
 * agreeing with the orders.
 *
 * Apply it to the revenue and to the commission SEPARATELY: deriving each owner's commission
 * from their own rounded revenue breaks the same equality on the commission side.
 */
export function allocate(total: number, owners: readonly RevenueOwner[]): Map<string, number> {
  const parts = owners.map((o) => {
    const exact = total * hundredths(o.sharePct);
    return { owner: o, base: Math.floor(exact / 10_000), frac: exact % 10_000 };
  });
  let left = total - parts.reduce((sum, p) => sum + p.base, 0);
  const order = [...parts].sort(
    (a, b) =>
      b.frac - a.frac ||
      Number(b.owner.isPrimary) - Number(a.owner.isPrimary) ||
      a.owner.ownerId.localeCompare(b.owner.ownerId),
  );
  for (const p of order) {
    if (left <= 0) break;
    p.base += 1;
    left -= 1;
  }
  return new Map(parts.map((p) => [p.owner.ownerId, p.base]));
}
