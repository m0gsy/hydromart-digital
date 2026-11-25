import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import {
  AI_ENGAGEMENT_REPOSITORY,
  AiEngagementRepository,
  AiSpan,
  DiscountTotals,
  NewSubscriptions,
} from '../ports/ai-engagement.repository';

export const MAX_SPANS = 200;
export const MAX_DEPOTS = 100;

/** HD-6 H4 part 2: discounts given (O-07) and subscriptions made (O-08). Counts and sums only. */
@Injectable()
export class AiEngagementService {
  constructor(@Inject(AI_ENGAGEMENT_REPOSITORY) private readonly repo: AiEngagementRepository) {}

  /** Refuses, rather than cuts, a question larger than one bounded read. */
  discounts(spans: readonly AiSpan[]): Promise<DiscountTotals> {
    if (spans.length > MAX_SPANS || new Set(spans.map((s) => s.depotId)).size > MAX_DEPOTS) {
      throw new UnprocessableEntityException(`Paling banyak ${MAX_SPANS} rentang atas ${MAX_DEPOTS} depot.`);
    }
    return this.repo.discounts(spans);
  }

  newSubscriptions(from: Date, to: Date): Promise<NewSubscriptions> {
    return this.repo.newSubscriptions(from, to);
  }
}
