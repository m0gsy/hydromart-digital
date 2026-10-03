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
 * Stock to move, summed by productId. Needed at every inventory-port call site because
 * `applyPromoQuote` can produce two `CreateOrderItemData` rows (paid + free) for one
 * product — a naive `.map()` would send inventory/depot-service two separate lines for the
 * same product, which: (consume) collides with depot-service's `@@unique([itemId, orderId])`
 * so the free units are never deducted; (restock on void) puts back BOTH quantities,
 * inflating stock; (reserve on reroute) collides with `StockReservation`'s own unique
 * constraint and fails the reroute outright. Used for reserve/release/consume/restock alike,
 * not just reservation — hence the name.
 */
export function stockLinesFor(
  items: CreateOrderItemData[],
): { productId: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  return [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}
