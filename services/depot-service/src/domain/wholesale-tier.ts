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
