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
