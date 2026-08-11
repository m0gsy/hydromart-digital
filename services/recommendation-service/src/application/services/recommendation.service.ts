import { Inject, Injectable } from '@nestjs/common';
import { addLocalDays, startOfLocalDay } from '@hydromart/platform';

import { RecommendationConfigService } from '../../config/recommendation-config.service';

import { rankReorder } from '../../domain/reorder';
import { rankRelated } from '../../domain/co-buy';
import { IngestCommand, RecommendationRepository } from '../ports/recommendation.repository';
import { RECOMMENDATION_TOKENS } from '../tokens';

export type RecItem = { productId: string; name: string; sku: string; unit: string; score: number };

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
/** Trending window used to fill a customer's empty reorder list (cold start). */
const COLD_START_TRENDING_DAYS = 30;

function clampLimit(limit: number): number {
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));
}

function clampDays(days: number): number {
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, days));
}



@Injectable()
export class RecommendationService {
  constructor(
    @Inject(RECOMMENDATION_TOKENS.Repository) private readonly repo: RecommendationRepository,
    private readonly config: RecommendationConfigService,
  ) {}

  async ingest(cmd: IngestCommand): Promise<void> {
    if (await this.repo.hasIngested(cmd.orderId)) return;
    await this.repo.applyIngest(cmd);
  }

  async reorder(customerId: string, limit: number): Promise<RecItem[]> {
    const rows = await this.repo.reorderRows(customerId);
    const ranked = rankReorder(rows, new Date(), clampLimit(limit));
    // ponytail: ML re-ranker seam — a future model would re-rank `ranked` before enrichment.
    const items = await this.enrich(ranked);
    if (items.length > 0) {
      return items;
    }
    // Cold start: a customer with no order history has nothing to reorder, and an empty
    // section reads as a broken page. Fall back to what is popular right now — network-wide,
    // since a brand-new customer has no depot affinity either.
    // ponytail: same RecItem[] shape, so the fallback is invisible to the client. If the UI
    // ever needs to caption it ("Populer saat ini"), that needs a response-shape change.
    return this.trending(null, COLD_START_TRENDING_DAYS, limit);
  }

  async related(productId: string, limit: number): Promise<RecItem[]> {
    const { rows, baseCount } = await this.repo.relatedRows(productId);
    const ranked = rankRelated(rows, baseCount, clampLimit(limit));
    // ponytail: ML re-ranker seam — a future model would re-rank `ranked` before enrichment.
    return this.enrich(ranked);
  }

  async trending(depotId: string | null, days: number, limit: number, now: Date = new Date()): Promise<RecItem[]> {
    // C2: the window opens at LOCAL midnight. Opening it at UTC midnight — 07:00 WIB —
    // meant that for the first seven hours of every day the board began mid-morning of the
    // day before and quietly dropped the previous local evening's orders.
    const tz = this.config.businessTimeZone;
    const fromDay = addLocalDays(startOfLocalDay(now, tz), -(clampDays(days) - 1), tz);
    // Summed, ranked and limited by Postgres (audit S-18).
    const ranked = await this.repo.trendingTotals(depotId, fromDay, clampLimit(limit));
    // ponytail: ML re-ranker seam — a future model would re-rank `ranked` before enrichment.
    return this.enrich(ranked);
  }

  private async enrich(ranked: { productId: string; score: number }[]): Promise<RecItem[]> {
    const refs = await this.repo.productRefs(ranked.map((r) => r.productId));
    const items: RecItem[] = [];
    for (const r of ranked) {
      const ref = refs.get(r.productId);
      if (!ref) continue; // defensive: skip ranked ids missing a product ref
      items.push({ productId: r.productId, name: ref.name, sku: ref.sku, unit: ref.unit, score: r.score });
    }
    return items;
  }
}
