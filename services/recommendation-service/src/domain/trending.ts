export type DailyRow = { productId: string; day: Date; count: number };

export function rankTrending(rows: DailyRow[], fromDay: Date, limit: number) {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.day.getTime() < fromDay.getTime()) continue;
    totals.set(r.productId, (totals.get(r.productId) ?? 0) + r.count);
  }
  return [...totals.entries()]
    .map(([productId, score]) => ({ productId, score }))
    .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId))
    .slice(0, limit);
}
