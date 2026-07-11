export type CoBuyRow = { relatedProductId: string; coCount: number };

export function confidence(coCount: number, baseCount: number): number {
  return baseCount > 0 ? coCount / baseCount : 0;
}

export function rankRelated(rows: CoBuyRow[], baseCount: number, limit: number) {
  return rows
    .map((r) => ({ productId: r.relatedProductId, score: confidence(r.coCount, baseCount), _co: r.coCount }))
    .sort((a, b) => b.score - a.score || b._co - a._co || a.productId.localeCompare(b.productId))
    .slice(0, limit)
    .map(({ productId, score }) => ({ productId, score }));
}
