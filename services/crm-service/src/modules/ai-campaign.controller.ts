import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { CampaignTotals } from '../application/ports/ai-campaign.repository';
import { AiCampaignService } from '../application/services/ai-campaign.service';
import { AiCampaignWindowDto } from './dto/ai-campaign.dto';

/** HD-6 H4 part 2: campaign facts for the AI read API (dashboard-service, internal key only). Counts; no recipient. */
@ApiTags('AI read sources')
@Controller({ path: 'campaigns/internal/ai', version: '1' })
export class AiCampaignController {
  constructor(private readonly ai: AiCampaignService) {}

  @ApiOkResponse({ description: 'campaigns, and their recipients by outcome, for campaigns finished inside the window.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('totals')
  @ApiOperation({ summary: 'Finished campaigns and their recipients inside a window, network-wide (internal service auth)' })
  totals(@Query() q: AiCampaignWindowDto): Promise<CampaignTotals> {
    return this.ai.totals(new Date(q.from), new Date(q.to));
  }
}
