// Depot wholesale pricing tiers (design 16b): quantity-band pricing for bulk buyers.
// A depot-scoped price for a quantity band, optionally pinned to one product.

/** A depot-scoped wholesale price for a quantity band (e.g. 20–49 gallons @ Rp16.000). */
export interface WholesaleTier {
  id: string;
  depotId: string;
  /** Pins the tier to one product; null = applies to any product. */
  productId: string | null;
  label: string;
  /** Inclusive lower bound of the quantity band. */
  minQty: number;
  /** Inclusive upper bound; null = open-ended (e.g. "50+"). */
  maxQty: number | null;
  priceIdr: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The wholesale price for `quantity` of `productId` at this depot, or undefined when no
 * band applies. Only active tiers count and the band is inclusive on both ends
 * (`maxQty: null` = open-ended).
 *
 * A tier pinned to the product beats a depot-wide one; among equally specific matches the
 * cheapest wins, so overlapping bands can never price a bulk buyer *up*.
 */
export function pickTierPrice(
  tiers: readonly WholesaleTier[],
  productId: string,
  quantity: number,
): number | undefined {
  const matches = tiers.filter(
    (t) =>
      t.active &&
      (t.productId === null || t.productId === productId) &&
      quantity >= t.minQty &&
      (t.maxQty === null || quantity <= t.maxQty),
  );
  if (matches.length === 0) return undefined;
  const pinned = matches.filter((t) => t.productId !== null);
  const winning = pinned.length > 0 ? pinned : matches;
  return Math.min(...winning.map((t) => t.priceIdr));
}
