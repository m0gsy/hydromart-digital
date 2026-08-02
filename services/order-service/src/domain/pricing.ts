export type PriceAdjustType = 'PERCENT' | 'FIXED';

export interface PriceAdjustment {
  adjustType: PriceAdjustType;
  value: number;
}

/**
 * Applies a dynamic-pricing adjustment to a base unit price. PERCENT scales
 * (value = signed percent, -10 = 10% off, +5 = 5% surge); FIXED adds a signed
 * rupiah delta. Never returns below 0. The caller rounds with money().
 */
export function applyAdjustment(base: number, adj: PriceAdjustment | null): number {
  if (!adj) return base;
  const raw = adj.adjustType === 'PERCENT' ? base * (1 + adj.value / 100) : base + adj.value;
  return Math.max(0, raw);
}

/**
 * Delivery is charged per galon delivered (Rp perUnitFee × number of galons).
 * Non-galon lines (bottled dus, accessories) add nothing to the delivery fee.
 *
 * Reads the catalog's `isGallon` flag, snapshotted onto the order line at checkout.
 * This used to match the "Galon…" prefix of the free-text `unit` label; the flag
 * replaced it so a label edit can no longer change what a customer is charged.
 */
export function galonQuantity(items: { isGallon: boolean; quantity: number }[]): number {
  return items.reduce((total, item) => (item.isGallon ? total + item.quantity : total), 0);
}

/** Flat reseller discount: `pct` percent of `base`, floored at 0. Caller rounds via money(). */
export function percentDiscount(base: number, pct: number): number {
  return Math.max(0, (base * pct) / 100);
}
