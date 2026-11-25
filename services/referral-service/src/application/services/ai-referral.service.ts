import { Inject, Injectable } from '@nestjs/common';

import { AI_REFERRAL_REPOSITORY, AiReferralRepository, ReferralTotals } from '../ports/ai-referral.repository';

/** HD-6 H4 part 2: the network's referrals for a window (O-06). Counts and sums only, never a customer. */
@Injectable()
export class AiReferralService {
  constructor(@Inject(AI_REFERRAL_REPOSITORY) private readonly repo: AiReferralRepository) {}

  totals(from: Date, to: Date): Promise<ReferralTotals> {
    return this.repo.totals(from, to);
  }
}
