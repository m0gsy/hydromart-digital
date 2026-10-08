// Merges a promo-service auto-apply quote (item 5 fase 1) into already-priced order items.
// Pure — no I/O. Called right after `priceLines()` on both checkout paths, before any
// voucher/membership discount logic, so `subtotal` downstream already reflects the promo.

import { money } from '@hydromart/platform';

import { CreateOrderItemData } from '../application/ports/order.repository';
import { AutoApplyAppliedLine, AutoApplyQuoteResult } from '../application/ports/promo-auto-apply.port';

export function applyPromoQuote(
  items: CreateOrderItemData[],
  quote: AutoApplyQuoteResult,
  /**
   * Products priced by a wholesale band. They are already at the depot's lowest price, so a
   * promo never touches them (the same rule that keeps reseller and membership discounts off
   * them) — and a promo that did would also leave `tierPricedTotal` stale against `subtotal`,
   * understating the reseller percentage base.
   */
  skipProductIds: ReadonlySet<string> = new Set(),
): { items: CreateOrderItemData[]; subtotal: number; appliedLines: AutoApplyAppliedLine[] } {
  const result: CreateOrderItemData[] = [];

  // Matched to `items` BY POSITION, not by productId. promo-service's quote() returns
  // `lines: input.lines.map((line) => evaluateLine(...))` — one entry per input line, same
  // order, always (confirmed in promo-rule.service.ts) — and both call sites in
  // order.service.ts build that request from the very same array they pass in here. A
  // productId-keyed Map (the old approach) collapsed two separate cart lines for the same
  // product (nothing stops a duplicate productId in `WalkInLineDto`) onto whichever quote
  // entry the Map happened to keep last, cross-applying one line's promo match to the other.
  const appliedLines: AutoApplyAppliedLine[] = items.map((original, i) => {
    const line = skipProductIds.has(original.productId) ? undefined : quote.lines[i];
    return {
      productId: original.productId,
      unitPrice: original.unitPrice,
      quantity: original.quantity,
      appliedRuleIds: line?.appliedRuleIds ?? [],
      unitPriceAfter: line?.unitPriceAfter ?? original.unitPrice,
      freeQty: line?.freeQty ?? 0,
    };
  });

  items.forEach((original, i) => {
    const line = skipProductIds.has(original.productId) ? undefined : quote.lines[i];
    if (!line) {
      result.push(original);
      return;
    }
    result.push({
      ...original,
      unitPrice: line.unitPriceAfter,
      lineTotal: money(line.unitPriceAfter * original.quantity),
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
        lineTotal: money(0),
      });
    }
  });

  const subtotal = money(result.reduce((sum, i) => sum + i.lineTotal, 0));
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
