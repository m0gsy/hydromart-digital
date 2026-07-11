import { Inject, Injectable } from '@nestjs/common';

import { rankReorder } from '../../domain/reorder';
import { rankRelated } from '../../domain/co-buy';
import { rankTrending } from '../../domain/trending';
import { IngestCommand, RecommendationRepository } from '../ports/recommendation.repository';
import { RECOMMENDATION_TOKENS } from '../tokens';

export type RecItem = { productId: string; name: string; sku: string; unit: string; score: number };

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

function clampLimit(limit: number): number {
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));
}

function clampDays(days: number): number {
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, days));
}

/** UTC-midnight of the given instant (mirrors the repo adapter's day bucketing). */
function utcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

@Injectable()
export class RecommendationService {
  constructor(@Inject(RECOMMENDATION_TOKENS.Repository) private readonly repo: RecommendationRepository) {}

  async ingest(cmd: IngestCommand): Promise<void> {
    if (await this.repo.hasIngested(cmd.orderId)) return;
    await this.repo.applyIngest(cmd);
  }

  async reorder(customerId: string, limit: number): Promise<RecItem[]> {
    const rows = await this.repo.reorderRows(customerId);
    const ranked = rankReorder(rows, new Date(), clampLimit(limit));
    // ponytail: ML re-ranker seam — a future model would re-rank `ranked` before enrichment.
    return this.enrich(ranked);
  }

  async related(productId: string, limit: number): Promise<RecItem[]> {
    const { rows, baseCount } = await this.repo.relatedRows(productId);
    const ranked = rankRelated(rows, baseCount, clampLimit(limit));
    // ponytail: ML re-ranker seam — a future model would re-rank `ranked` before enrichment.
    return this.enrich(ranked);
  }

  async trending(depotId: string | null, days: number, limit: number, now: Date = new Date()): Promise<RecItem[]> {
    const fromDay = new Date(utcMidnight(now).getTime() - (clampDays(days) - 1) * 86_400_000);
    const rows = await this.repo.trendingRows(depotId, fromDay);
    const ranked = rankTrending(rows, fromDay, clampLimit(limit));
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
