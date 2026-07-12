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
 * Galon lines are detected by the catalog's unit label ("Galon 19L", "Galon 15L",
 * …); non-galon lines (bottled dus, accessories) add nothing to the delivery fee.
 * ponytail: unit-string heuristic — switch to a real product/item-type flag if
 * the catalog's unit labels ever drift away from the "Galon…" prefix.
 */
export function galonQuantity(items: { unit: string; quantity: number }[]): number {
  return items.reduce(
    (total, item) => (item.unit.trim().toLowerCase().startsWith('galon') ? total + item.quantity : total),
    0,
  );
}
