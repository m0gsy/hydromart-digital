import { InvalidOwnerSharesError } from './errors';

/** One owner of a franchise depot and the share of its revenue they take. */
export interface DepotOwnerShare {
  ownerId: string;
  /** 0 < sharePct <= 100, at most two decimals (a three-way split is 33.34 / 33.33 / 33.33). */
  sharePct: number;
  isPrimary: boolean;
}

/** Hundredths of a percent: shares are compared as integers so 33.33 * 3 cannot drift. */
const hundredths = (pct: number): number => Math.round(pct * 100);

/**
 * The legacy single-owner form: one owner taking everything. Both the old `ownerId` field and
 * a one-element `owners` list mean exactly this.
 */
export function soleOwner(ownerId: string): DepotOwnerShare[] {
  return [{ ownerId, sharePct: 100, isPrimary: true }];
}

/**
 * Throws unless the set is one a depot can be paid out against: non-empty, owners unique,
 * every share positive with at most two decimals, shares summing to exactly 100, and exactly
 * one primary. A single owner is promoted to primary so the caller need not say so.
 */
export function assertValidOwners(owners: readonly DepotOwnerShare[]): DepotOwnerShare[] {
  if (owners.length === 0) throw new InvalidOwnerSharesError('At least one owner is required.');
  const ids = new Set(owners.map((o) => o.ownerId));
  if (ids.size !== owners.length) throw new InvalidOwnerSharesError('An owner is listed twice.');
  for (const o of owners) {
    const h = hundredths(o.sharePct);
    if (
      !Number.isFinite(o.sharePct) ||
      h <= 0 ||
      h > 10_000 ||
      Math.abs(o.sharePct * 100 - h) > 1e-6
    ) {
      throw new InvalidOwnerSharesError(
        'Each share must be above 0 and at most 100, with at most two decimals.',
      );
    }
  }
  const total = owners.reduce((sum, o) => sum + hundredths(o.sharePct), 0);
  if (total !== 10_000) throw new InvalidOwnerSharesError('Owner shares must add up to 100%.');
  const normalised = owners.length === 1 ? [{ ...owners[0]!, isPrimary: true }] : [...owners];
  if (normalised.filter((o) => o.isPrimary).length !== 1) {
    throw new InvalidOwnerSharesError('Exactly one owner must be the primary.');
  }
  return normalised.map((o) => ({ ...o, sharePct: hundredths(o.sharePct) / 100 }));
}

/** The primary's account id, which `Depot.ownerId` mirrors for older readers. */
export function primaryOwnerId(owners: readonly DepotOwnerShare[]): string | null {
  return owners.find((o) => o.isPrimary)?.ownerId ?? null;
}

/** Account ids that currently own a depot record (falls back to the mirrored primary). */
export function ownerIdsOf(depot: {
  ownerId: string | null;
  owners?: readonly DepotOwnerShare[];
}): string[] {
  if (depot.owners) return depot.owners.map((o) => o.ownerId);
  return depot.ownerId ? [depot.ownerId] : [];
}
