import { money } from '@hydromart/platform';

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

/** A depot's resolved pricing for one product: optional override + optional active rule. */
export interface DepotPrice {
  sellPrice?: number;
  adjustType?: PriceAdjustType;
  value?: number;
  /**
   * Wholesale band price for the quantity being ordered (design 16b). An absolute unit
   * price: when present it replaces `sellPrice` AND the rule adjustment for that line.
   */
  tierPrice?: number;
}

/** The catalog fields pricing actually reads. Structural, so both ports satisfy it. */
export interface PriceableProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  volumeMl: number | null;
  isGallon: boolean;
  basePrice: number;
}

/** One priced line, snapshotted. Identical in shape to an order line, on purpose. */
export interface PricedLine {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  volumeMl: number | null;
  isGallon: boolean;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface PricedLines {
  items: PricedLine[];
  subtotal: number;
  /** Rupiah that came from a wholesale band — excluded from percentage discounts. */
  tierPricedTotal: number;
  /** The same exclusion per line, which the flat galon price needs (it reprices per line). */
  tieredProductIds: Set<string>;
}

/**
 * A1 — THE price. Static per-depot override + the winning active pricing rule, with a
 * matching wholesale band outranking both as an absolute unit price (design 16b).
 *
 * Pure, and deliberately so. This block used to live inside `OrderService.priceLines`,
 * bound to three upstream reads, so nothing else could reach it — and the cart, which
 * cannot make those reads from where it sits, grew a second rule of its own out of
 * `product.basePrice`. Two rules, one screen: a galon at a depot with a live +10% rule
 * was quoted at Rp20.000 and billed at Rp22.000, measured, on this repo's own stack.
 *
 * Extracting it as a function that TAKES its data (rather than fetching it) is what lets
 * the cart and checkout share one answer. Both callers still do their own I/O; only the
 * arithmetic is shared, because only the arithmetic was ever duplicated.
 */
export function priceLines(
  lines: { productId: string; quantity: number }[],
  productById: Map<string, PriceableProduct>,
  prices: Map<string, DepotPrice>,
): PricedLines {
  const items: PricedLine[] = [];
  let tierPricedTotal = 0;
  const tieredProductIds = new Set<string>();
  for (const line of lines) {
    // Every line is resolved before it gets here, and the assertion says so rather than
    // hiding a miss: checkout rejects an unresolvable product outright (`pricedAll`), and
    // the cart drops the delisted line before pricing. A silent `continue` would have
    // dropped a line the customer put in their basket and still charged them a subtotal.
    const product = productById.get(line.productId)!;
    const priceRow = prices.get(product.id);
    const base = priceRow?.sellPrice ?? product.basePrice;
    const adj = priceRow?.adjustType
      ? { adjustType: priceRow.adjustType, value: priceRow.value ?? 0 }
      : null;
    const tiered = typeof priceRow?.tierPrice === 'number';
    const unitPrice = tiered ? money(priceRow!.tierPrice!) : money(applyAdjustment(base, adj));
    const lineTotal = money(unitPrice * line.quantity);
    if (tiered) {
      tierPricedTotal += lineTotal;
      tieredProductIds.add(product.id);
    }
    items.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unit: product.unit,
      // Frozen for the same reason unitPrice is: a later catalog restatement
      // (19L -> 19.2L) must not silently rewrite what past orders reconcile to.
      volumeMl: product.volumeMl,
      isGallon: product.isGallon,
      unitPrice,
      quantity: line.quantity,
      lineTotal,
    });
  }
  return {
    items,
    subtotal: money(items.reduce((sum, i) => sum + i.lineTotal, 0)),
    tierPricedTotal,
    tieredProductIds,
  };
}

/** The reseller fields pricing reads — structural, so the port satisfies it. */
export interface ResellerPricing {
  active: boolean;
  discountPct: number;
  flatGallonPriceIdr: number;
  homeDepotId: string | null;
}

/**
 * A9: may this agen be priced at the depot doing the selling?
 *
 * The old rule was `active && (pct > 0 || flat > 0)`, written out three times — twice in
 * order.service and once in the checkout screen — and none of the three asked which depot.
 * An agen registered at depot A drew their agen price shopping at depot B, a franchise
 * the depot never agreed to fund.
 *
 * `homeDepotId` null means "cannot prove which depot", which is not the same as "any
 * depot": it declines rather than guesses. A sale with no depot at all (an order not yet
 * routed) keeps the old behaviour, because there is no depot to be wrong about yet.
 */
export function resellerApplies(
  reseller: ResellerPricing | null,
  sellingDepotId: string | null,
): boolean {
  if (reseller?.active !== true) return false;
  if (reseller.discountPct <= 0 && reseller.flatGallonPriceIdr <= 0) return false;
  if (sellingDepotId === null) return true;
  return reseller.homeDepotId === sellingDepotId;
}

/**
 * What an agen is let off on this bill. Expressed as a discount rather than by rewriting
 * `unitPrice`, so the order still records what the goods list at and what the agen was let
 * off; that pair is what reconciliation reads.
 *
 * Wholesale-band lines are excluded either way: they are already at the depot's bulk price
 * and must not be discounted twice.
 */
export function resellerDiscountFor(
  reseller: ResellerPricing,
  items: { productId: string; isGallon: boolean; unitPrice: number; quantity: number }[],
  subtotal: number,
  tieredProductIds: Set<string>,
  tierPricedTotal: number,
): number {
  if (reseller.flatGallonPriceIdr > 0) {
    // Depot SOP: every galon costs the agen a flat Rp5.000 whatever it lists at, so the
    // discount is the per-line gap down to that price. A line already BELOW the flat price
    // is left alone (max 0), never marked up.
    return money(
      items
        .filter((i) => i.isGallon && !tieredProductIds.has(i.productId))
        .reduce(
          (sum, i) => sum + Math.max(0, i.unitPrice - reseller.flatGallonPriceIdr) * i.quantity,
          0,
        ),
    );
  }
  const discountable = money(Math.max(0, subtotal - tierPricedTotal));
  return money(Math.min(subtotal, percentDiscount(discountable, reseller.discountPct)));
}
