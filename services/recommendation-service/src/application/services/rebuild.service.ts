import { Inject, Injectable } from '@nestjs/common';

import { OrderFeedPort } from '../ports/order-feed.port';
import { RecommendationRepository } from '../ports/recommendation.repository';
import { RECOMMENDATION_TOKENS } from '../tokens';
import { RecommendationService } from './recommendation.service';

// ponytail: defensive cap against a runaway/misbehaving feed (e.g. a cursor that never
// goes null). At MAX_PAGES * limit orders this would already be a huge backfill; a real
// cap-hit would need alerting, not silent truncation, if that ever becomes reachable.
const MAX_PAGES = 1000;

@Injectable()
export class RebuildService {
  constructor(
    @Inject(RECOMMENDATION_TOKENS.OrderFeed) private readonly feed: OrderFeedPort,
    private readonly recommendations: RecommendationService,
    @Inject(RECOMMENDATION_TOKENS.Repository) private readonly repo: RecommendationRepository,
  ) {}

  /**
   * REC-01: rebuild the daily-sales table from the order feed, bucketed by the business-zone day.
   * Aggregated in memory first and swapped in one transaction, so trending never reads an empty
   * table; an empty feed changes nothing (a feed outage must not wipe the table).
   */
  async rebucketDailySales(limit: number): Promise<{ orders: number; rows: number }> {
    const totals = new Map<string, { productId: string; depotId: string | null; day: Date; count: number }>();
    let orders = 0;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await this.feed.fetchCompleted(cursor, limit);
      for (const order of result.orders) {
        orders += 1;
        const day = this.recommendations.dayBucket(order.at);
        for (const item of order.items) {
          const key = `${item.productId}|${order.depotId ?? ''}|${day.getTime()}`;
          const row = totals.get(key) ?? { productId: item.productId, depotId: order.depotId, day, count: 0 };
          row.count += item.quantity ?? 1;
          totals.set(key, row);
        }
      }
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    if (orders === 0) return { orders: 0, rows: 0 };
    await this.repo.replaceDailySales([...totals.values()]);
    return { orders, rows: totals.size };
  }

  async run(limit: number): Promise<{ ingested: number }> {
    let cursor: string | null = null;
    let ingested = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await this.feed.fetchCompleted(cursor, limit);
      for (const order of result.orders) {
        await this.recommendations.ingest(order); // idempotent: safe to re-pull already-ingested orders
        ingested += 1;
      }
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }

    return { ingested };
  }
}
