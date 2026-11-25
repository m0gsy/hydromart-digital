import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import {
  AI_LOYALTY_REPOSITORY,
  AiLoyaltyRepository,
  AiSpan,
  PointsOutstanding,
  RedemptionTotals,
} from '../ports/ai-loyalty.repository';

export const MAX_SPANS = 200;
export const MAX_DEPOTS = 100;

/** HD-6 H4 part 2: the facts behind O-02 (points redeemed) and O-04 (points outstanding). Counts and sums only. */
@Injectable()
export class AiLoyaltyService {
  constructor(@Inject(AI_LOYALTY_REPOSITORY) private readonly repo: AiLoyaltyRepository) {}

  /** Refuses, rather than cuts, a question larger than one bounded read. */
  redemptions(spans: readonly AiSpan[]): Promise<RedemptionTotals> {
    if (spans.length > MAX_SPANS || new Set(spans.map((s) => s.depotId)).size > MAX_DEPOTS) {
      throw new UnprocessableEntityException(`Paling banyak ${MAX_SPANS} rentang atas ${MAX_DEPOTS} depot.`);
    }
    return this.repo.redemptions(spans);
  }

  pointsOutstanding(before: Date): Promise<PointsOutstanding> {
    return this.repo.pointsOutstanding(before);
  }
}
