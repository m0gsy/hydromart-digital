import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { ReferralTotals } from '../application/ports/ai-referral.repository';
import { AiReferralService } from '../application/services/ai-referral.service';
import { AiReferralWindowDto } from './dto/ai-referral.dto';

/** HD-6 H4 part 2: referral facts for the AI read API (dashboard-service, internal key only). Network totals; no customer. */
@ApiTags('AI read sources')
@Controller({ path: 'referrals/internal/ai', version: '1' })
export class AiReferralController {
  constructor(private readonly ai: AiReferralService) {}

  @ApiOkResponse({ description: 'invited, qualified, referrerPoints and refereePoints for the window.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('totals')
  @ApiOperation({ summary: 'Referrals made and qualified inside a window, network-wide (internal service auth)' })
  totals(@Query() q: AiReferralWindowDto): Promise<ReferralTotals> {
    return this.ai.totals(new Date(q.from), new Date(q.to));
  }
}
