export type PurchaseRow = {
  productId: string;
  purchaseCount: number;
  lastPurchasedAt: Date;
  /** Units on the latest order that carried it (flow 7c). Null/absent on older rows. */
  lastQuantity?: number | null;
};

const HALF_LIFE_DAYS = 30;

export function scoreReorder(row: PurchaseRow, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - row.lastPurchasedAt.getTime()) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS); // 1 fresh -> 0.5 at 30d
  return row.purchaseCount * (0.5 + 0.5 * recency); // frequency, recency-weighted, never below half
}

export function rankReorder(rows: PurchaseRow[], now: Date, limit: number) {
  return rows
    .map((r) => ({ productId: r.productId, score: scoreReorder(r, now), _at: r.lastPurchasedAt, _qty: r.lastQuantity }))
    .sort((a, b) => b.score - a.score || b._at.getTime() - a._at.getTime() || a.productId.localeCompare(b.productId))
    .slice(0, limit)
    // Null (a row older than the column) and absent both read as "unknown": undefined, which
    // the JSON answer leaves out.
    .map(({ productId, score, _qty }) => ({ productId, score, lastQuantity: _qty ?? undefined }));
}

/**
 * What the customer ORDERED of each product on one order: its lines' units summed, minus a
 * promo's free row (a 0-priced row beside a paid row of the same product, order-service's
 * collapsePromoFreeRows rule). A free item with no paid sibling was ordered. No quantity sent
 * (an older producer) is one unit. Ingest and the lastQuantity backfill both read it here.
 */
export function orderedUnitsByProduct(
  items: readonly { productId: string; quantity?: number; unitPrice?: number }[],
): Map<string, number> {
  const paid = new Set(items.filter((i) => (i.unitPrice ?? 1) > 0).map((i) => i.productId));
  const out = new Map<string, number>();
  for (const item of items) {
    const units = item.unitPrice === 0 && paid.has(item.productId) ? 0 : (item.quantity ?? 1);
    out.set(item.productId, (out.get(item.productId) ?? 0) + units);
  }
  return out;
}
