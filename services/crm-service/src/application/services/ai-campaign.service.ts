import { Inject, Injectable } from '@nestjs/common';

import { AI_CAMPAIGN_REPOSITORY, AiCampaignRepository, CampaignTotals } from '../ports/ai-campaign.repository';

/** HD-6 H4 part 2: the network's finished campaigns for a window (O-09). Counts only, never a recipient. */
@Injectable()
export class AiCampaignService {
  constructor(@Inject(AI_CAMPAIGN_REPOSITORY) private readonly repo: AiCampaignRepository) {}

  totals(from: Date, to: Date): Promise<CampaignTotals> {
    return this.repo.totals(from, to);
  }
}
