export type PurchaseRow = { productId: string; purchaseCount: number; lastPurchasedAt: Date };

const HALF_LIFE_DAYS = 30;

export function scoreReorder(row: PurchaseRow, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - row.lastPurchasedAt.getTime()) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS); // 1 fresh -> 0.5 at 30d
  return row.purchaseCount * (0.5 + 0.5 * recency); // frequency, recency-weighted, never below half
}

export function rankReorder(rows: PurchaseRow[], now: Date, limit: number) {
  return rows
    .map((r) => ({ productId: r.productId, score: scoreReorder(r, now), _at: r.lastPurchasedAt }))
    .sort((a, b) => b.score - a.score || b._at.getTime() - a._at.getTime() || a.productId.localeCompare(b.productId))
    .slice(0, limit)
    .map(({ productId, score }) => ({ productId, score }));
}
