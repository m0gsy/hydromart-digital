import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import {
  AiCustomerRepository,
  AiSpan,
  CohortCell,
  CustomerSegmentStats,
  CustomerWindowStats,
  RatingStats,
  RefillSplitStats,
  SegmentThresholds,
} from '../ports/ai-customer.repository';
import { OrderConfigService } from '../../config/order-config.service';
import { ORDER_TOKENS } from '../tokens';

/** Most depots one AI read may ask about; past it is 422, never a silent cut. */
export const MAX_AI_DEPOTS = 100;

/**
 * HD-6 H3: customer, rating and gallon facts for the AI read API, over the spans the caller may
 * read. Spans are checked here (not trusted): a depot list past the cap, or two overlapping spans
 * of one depot (which would count an order twice), is refused with 422.
 */
@Injectable()
export class AiCustomerMetricsService {
  constructor(
    @Inject(ORDER_TOKENS.AiCustomerRepository) private readonly repo: AiCustomerRepository,
    private readonly config: OrderConfigService,
  ) {}

  private check(spans: readonly AiSpan[]): void {
    if (new Set(spans.map((s) => s.depotId)).size > MAX_AI_DEPOTS) {
      throw new UnprocessableEntityException(`Paling banyak ${MAX_AI_DEPOTS} depot per baca.`);
    }
    const byDepot = new Map<string, AiSpan[]>();
    for (const s of spans) byDepot.set(s.depotId, [...(byDepot.get(s.depotId) ?? []), s]);
    for (const list of byDepot.values()) {
      const sorted = [...list].sort((a, b) => a.from.getTime() - b.from.getTime());
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].from < sorted[i - 1].to) {
          throw new UnprocessableEntityException('Rentang satu depot tidak boleh tumpang tindih.');
        }
      }
    }
  }

  customers(spans: readonly AiSpan[], periodFrom: Date): Promise<CustomerWindowStats> {
    this.check(spans);
    return this.repo.customerWindow(spans, periodFrom);
  }

  cohorts(spans: readonly AiSpan[]): Promise<CohortCell[]> {
    this.check(spans);
    return this.repo.customerCohorts(spans, this.config.businessTimeZone);
  }

  ratings(spans: readonly AiSpan[]): Promise<RatingStats> {
    this.check(spans);
    return this.repo.ratingStats(spans);
  }

  segments(depotIds: readonly string[], at: SegmentThresholds): Promise<CustomerSegmentStats> {
    this.checkDepots(depotIds);
    return this.repo.customerSegments(depotIds, at);
  }

  gallons(spans: readonly AiSpan[]): Promise<{ gallons: number }> {
    this.check(spans);
    return this.repo.gallonsSold(spans).then((gallons) => ({ gallons }));
  }

  refill(spans: readonly AiSpan[]): Promise<RefillSplitStats> {
    this.check(spans);
    return this.repo.refillSplit(spans);
  }

  live(depotIds: readonly string[]): Promise<{ byStatus: { status: string; count: number }[] }> {
    this.checkDepots(depotIds);
    return this.repo.liveByStatus(depotIds).then((byStatus) => ({ byStatus }));
  }

  private checkDepots(depotIds: readonly string[]): void {
    if (new Set(depotIds).size > MAX_AI_DEPOTS) {
      throw new UnprocessableEntityException(`Paling banyak ${MAX_AI_DEPOTS} depot per baca.`);
    }
  }
}
