// Merges a promo-service auto-apply quote (item 5 fase 1) into already-priced order items.
// Pure — no I/O. Called right after `priceLines()` on both checkout paths, before any
// voucher/membership discount logic, so `subtotal` downstream already reflects the promo.

import { CreateOrderItemData } from '../application/ports/order.repository';
import { AutoApplyAppliedLine, AutoApplyQuoteResult } from '../application/ports/promo-auto-apply.port';

export function applyPromoQuote(
  items: CreateOrderItemData[],
  quote: AutoApplyQuoteResult,
): { items: CreateOrderItemData[]; subtotal: number; appliedLines: AutoApplyAppliedLine[] } {
  const byProduct = new Map(quote.lines.map((l) => [l.productId, l]));
  const result: CreateOrderItemData[] = [];

  // One entry per ORIGINAL line (never split, unlike `result` below) — this is exactly what
  // `PromoAutoApplyPort.apply()` needs to send promo-service: the original unitPrice/quantity
  // plus what this line's quote already decided. A line with no quote entry gets a harmless
  // no-op shape (empty appliedRuleIds, unitPriceAfter == unitPrice, freeQty 0).
  const appliedLines: AutoApplyAppliedLine[] = items.map((original) => {
    const line = byProduct.get(original.productId);
    return {
      productId: original.productId,
      unitPrice: original.unitPrice,
      quantity: original.quantity,
      appliedRuleIds: line?.appliedRuleIds ?? [],
      unitPriceAfter: line?.unitPriceAfter ?? original.unitPrice,
      freeQty: line?.freeQty ?? 0,
    };
  });

  for (const original of items) {
    const line = byProduct.get(original.productId);
    if (!line) {
      result.push(original);
      continue;
    }
    result.push({
      ...original,
      unitPrice: line.unitPriceAfter,
      lineTotal: line.unitPriceAfter * original.quantity,
    });
    if (line.freeQty > 0) {
      // A separate row, not a split within the same row — `CreateOrderItemData` carries one
      // unitPrice/quantity/lineTotal per row, so a free portion at a DIFFERENT price (zero)
      // has to be its own row. Same catalog identity as the paid row so stock, galon
      // counting (`isGallon`) and the receipt still recognise what product it is.
      result.push({
        ...original,
        unitPrice: 0,
        quantity: line.freeQty,
        lineTotal: 0,
      });
    }
  }

  const subtotal = result.reduce((sum, i) => sum + i.lineTotal, 0);
  return { items: result, subtotal, appliedLines };
}

/**
 * Stock to reserve, summed by productId. Needed because `applyPromoQuote` can produce two
 * `CreateOrderItemData` rows (paid + free) for one product — `reserveThenCreate`'s existing
 * `data.items.map(...)` would otherwise send inventory-service two separate reserve lines
 * for the same product, which this repo's inventory port has never had to handle and should
 * not be asked to guess about.
 */
export function reservationLinesFor(
  items: CreateOrderItemData[],
): { productId: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  return [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}
