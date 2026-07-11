import { Inject, Injectable } from '@nestjs/common';

import { OrderFeedPort } from '../ports/order-feed.port';
import { FORECAST_TOKENS } from '../tokens';
import { ForecastService } from './forecast.service';

const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

// ponytail: defensive cap against a runaway/misbehaving feed (e.g. a cursor that never
// goes null). At MAX_PAGES * limit orders this would already be a huge backfill; a real
// cap-hit would need alerting, not silent truncation, if that ever becomes reachable.
const MAX_PAGES = 1000;

const clampLimit = (limit: number): number => Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));

@Injectable()
export class RebuildService {
  constructor(
    @Inject(FORECAST_TOKENS.OrderFeed) private readonly feed: OrderFeedPort,
    private readonly forecasts: ForecastService,
  ) {}

  async rebuild(limit: number = DEFAULT_LIMIT): Promise<{ ingested: number; pages: number }> {
    const pageSize = clampLimit(limit);
    let cursor: string | null = null;
    let ingested = 0;
    let pages = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await this.feed.fetchCompleted(cursor, pageSize);
      pages += 1;
      for (const order of result.orders) {
        await this.forecasts.ingest(order); // idempotent: safe to re-pull already-ingested orders
        ingested += 1;
      }
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }

    return { ingested, pages };
  }
}
