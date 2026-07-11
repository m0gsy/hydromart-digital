import { PurchaseRow } from '../../src/domain/reorder';
import { CoBuyRow } from '../../src/domain/co-buy';
import { DailyRow } from '../../src/domain/trending';
import {
  IngestCommand,
  IngestItem,
  RecommendationRepository,
} from '../../src/application/ports/recommendation.repository';
import { OrderFeedPort } from '../../src/application/ports/order-feed.port';

/** Derives the UTC-midnight calendar day used for daily-sales bucketing (mirrors the Prisma adapter). */
function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export interface PurchaseRecord {
  customerId: string;
  productId: string;
  purchaseCount: number;
  lastPurchasedAt: Date;
}

export interface ProductRefRecord {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  buyCount: number;
}

export interface DailySalesRecord {
  productId: string;
  depotId: string | null;
  day: Date;
  count: number;
}

export interface CoBuyRecord {
  productId: string;
  relatedProductId: string;
  coCount: number;
}

/**
 * In-memory stand-in for RecommendationRepository, mirroring the Prisma adapter's write
 * semantics exactly (increment counts, symmetric co-buy both directions, UTC-day daily
 * bucketing, ref upsert + buyCount). Arrays/set are public so tests can seed and inspect
 * state directly without going through applyIngest.
 */
export class FakeRecommendationRepository implements RecommendationRepository {
  purchases: PurchaseRecord[] = [];
  refs: ProductRefRecord[] = [];
  dailySales: DailySalesRecord[] = [];
  coBuys: CoBuyRecord[] = [];
  ingestedOrderIds = new Set<string>();

  async hasIngested(orderId: string): Promise<boolean> {
    return this.ingestedOrderIds.has(orderId);
  }

  async applyIngest(cmd: IngestCommand): Promise<void> {
    const day = utcDay(cmd.at);

    for (const item of cmd.items) {
      this.upsertPurchase(cmd.customerId, item.productId, cmd.at);
      this.upsertRef(item);
      this.upsertDailySales(item.productId, cmd.depotId, day);
    }

    for (let i = 0; i < cmd.items.length; i += 1) {
      for (let j = i + 1; j < cmd.items.length; j += 1) {
        const a = cmd.items[i];
        const b = cmd.items[j];
        if (a.productId === b.productId) continue; // same product twice in the order: no self co-buy

        this.upsertCoBuy(a.productId, b.productId);
        this.upsertCoBuy(b.productId, a.productId);
      }
    }

    this.ingestedOrderIds.add(cmd.orderId);
  }

  private upsertPurchase(customerId: string, productId: string, at: Date): void {
    const row = this.purchases.find((p) => p.customerId === customerId && p.productId === productId);
    if (row) {
      row.purchaseCount += 1;
      row.lastPurchasedAt = at;
    } else {
      this.purchases.push({ customerId, productId, purchaseCount: 1, lastPurchasedAt: at });
    }
  }

  private upsertRef(item: IngestItem): void {
    const row = this.refs.find((r) => r.productId === item.productId);
    if (row) {
      row.name = item.productName;
      row.sku = item.sku;
      row.unit = item.unit;
      row.buyCount += 1;
    } else {
      this.refs.push({
        productId: item.productId,
        name: item.productName,
        sku: item.sku,
        unit: item.unit,
        buyCount: 1,
      });
    }
  }

  private upsertDailySales(productId: string, depotId: string | null, day: Date): void {
    const row = this.dailySales.find(
      (d) => d.productId === productId && d.depotId === depotId && d.day.getTime() === day.getTime(),
    );
    if (row) {
      row.count += 1;
    } else {
      this.dailySales.push({ productId, depotId, day, count: 1 });
    }
  }

  private upsertCoBuy(productId: string, relatedProductId: string): void {
    const row = this.coBuys.find((c) => c.productId === productId && c.relatedProductId === relatedProductId);
    if (row) {
      row.coCount += 1;
    } else {
      this.coBuys.push({ productId, relatedProductId, coCount: 1 });
    }
  }

  async reorderRows(customerId: string): Promise<PurchaseRow[]> {
    return this.purchases
      .filter((p) => p.customerId === customerId)
      .map((p) => ({ productId: p.productId, purchaseCount: p.purchaseCount, lastPurchasedAt: p.lastPurchasedAt }));
  }

  async relatedRows(productId: string): Promise<{ rows: CoBuyRow[]; baseCount: number }> {
    const rows = this.coBuys
      .filter((c) => c.productId === productId)
      .map((c) => ({ relatedProductId: c.relatedProductId, coCount: c.coCount }));
    const ref = this.refs.find((r) => r.productId === productId);
    return { rows, baseCount: ref?.buyCount ?? 0 };
  }

  async trendingRows(depotId: string | null, fromDay: Date): Promise<DailyRow[]> {
    return this.dailySales
      .filter((d) => d.day.getTime() >= fromDay.getTime() && (depotId ? d.depotId === depotId : true))
      .map((d) => ({ productId: d.productId, day: d.day, count: d.count }));
  }

  async productRefs(ids: string[]): Promise<Map<string, { name: string; sku: string; unit: string }>> {
    const idSet = new Set(ids);
    const map = new Map<string, { name: string; sku: string; unit: string }>();
    for (const r of this.refs) {
      if (idSet.has(r.productId)) map.set(r.productId, { name: r.name, sku: r.sku, unit: r.unit });
    }
    return map;
  }
}

/** In-memory stand-in for OrderFeedPort: paginates a fixed list of orders by index cursor. */
export class FakeOrderFeed implements OrderFeedPort {
  constructor(public orders: IngestCommand[] = []) {}

  async fetchCompleted(cursor: string | null, limit: number): Promise<{ orders: IngestCommand[]; nextCursor: string | null }> {
    const start = cursor ? Number(cursor) : 0;
    const page = this.orders.slice(start, start + limit);
    const end = start + page.length;
    return { orders: page, nextCursor: end < this.orders.length ? String(end) : null };
  }
}
