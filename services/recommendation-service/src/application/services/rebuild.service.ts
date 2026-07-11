import { Inject, Injectable } from '@nestjs/common';

import { OrderFeedPort } from '../ports/order-feed.port';
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
  ) {}

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
