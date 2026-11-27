import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import {
  AiCustomerRepository,
  AiSpan,
  AreaPoints,
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
/** HD-20c: most distinct (customer, pin) rows one areas read may carry; past it is 422. */
export const MAX_AREA_POINTS = 50_000;

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

  async areaPoints(spans: readonly AiSpan[]): Promise<AreaPoints> {
    this.check(spans);
    const found = await this.repo.areaPoints(spans, MAX_AREA_POINTS);
    if (!found) throw new UnprocessableEntityException(`Lebih dari ${MAX_AREA_POINTS} titik pesanan; persempit cakupan.`);
    return found;
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

  /** One grouped read: the total and the per-depot figures (depots that sold none are absent; the caller lists them as 0). */
  gallons(spans: readonly AiSpan[]): Promise<{ gallons: number; byDepot: { depotId: string; gallons: number }[] }> {
    this.check(spans);
    return this.repo.gallonsSold(spans).then((byDepot) => ({ gallons: byDepot.reduce((s, r) => s + r.gallons, 0), byDepot }));
  }

  refill(spans: readonly AiSpan[]): Promise<RefillSplitStats> {
    this.check(spans);
    return this.repo.refillSplit(spans);
  }

  async cancelledBeforeDeparture(spans: readonly AiSpan[]): Promise<{ cancelled: number }> {
    this.check(spans);
    return { cancelled: await this.repo.cancelledBeforeDeparture(spans) };
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
