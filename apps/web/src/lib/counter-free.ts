/**
 * Units a counter sale hands over at no charge: buy-X-get-Y units and bundle gifts.
 *
 * The server adds them as price-0 rows and takes them out of stock like any other unit, but
 * the till only ever said "gratis senilai Rp X". So a cashier could hand over two galon where
 * the stock count moved by three, and a basket whose bonus the shelf could not cover was
 * refused only after the buyer had agreed the price. These two answers are what the till
 * needs to say so before and after Bayar.
 */
export interface FreeItem {
  productId: string;
  quantity: number;
}

/** Products whose paid + free units are more than the depot has. */
export function freeShortfall(
  free: readonly FreeItem[],
  paid: ReadonlyMap<string, number>,
  available: ReadonlyMap<string, number>,
): { productId: string; need: number; have: number }[] {
  return free
    .map((f) => ({
      productId: f.productId,
      need: (paid.get(f.productId) ?? 0) + f.quantity,
      have: available.get(f.productId) ?? 0,
    }))
    .filter((r) => r.need > r.have);
}

/**
 * Free units the quote promised that the recorded order does not carry. The server drops a
 * gift it cannot stock rather than fail the sale, and nothing told the cashier.
 */
export function droppedFree(
  promised: readonly FreeItem[],
  items: readonly { productId: string; unitPrice: number; quantity: number }[],
): FreeItem[] {
  const given = new Map<string, number>();
  for (const i of items) {
    if (i.unitPrice === 0) given.set(i.productId, (given.get(i.productId) ?? 0) + i.quantity);
  }
  return promised
    .map((p) => ({ productId: p.productId, quantity: p.quantity - (given.get(p.productId) ?? 0) }))
    .filter((p) => p.quantity > 0);
}
