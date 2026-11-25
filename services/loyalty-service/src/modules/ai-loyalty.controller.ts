import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { AiLoyaltyService } from '../application/services/ai-loyalty.service';
import { PointsOutstanding, RedemptionTotals } from '../application/ports/ai-loyalty.repository';
import { AiPointsOutstandingQueryDto, AiRedemptionsDto } from './dto/ai-loyalty.dto';

/**
 * HD-6 H4 part 2: loyalty facts for the AI read API (dashboard-service, internal key only). The caller
 * has already narrowed what the asker may read to spans; no route returns a customer id or a name.
 */
@ApiTags('AI read sources')
@Controller({ path: 'loyalty/internal/ai', version: '1' })
export class AiLoyaltyController {
  constructor(private readonly ai: AiLoyaltyService) {}

  @ApiOkResponse({ description: 'redemptions, points, redeemers (distinct customers) and unplaced.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('redemptions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Redemptions handed over inside depot spans (internal service auth)' })
  redemptions(@Body() body: AiRedemptionsDto): Promise<RedemptionTotals> {
    return this.ai.redemptions(body.spans.map((s) => ({ depotId: s.depotId, from: new Date(s.from), to: new Date(s.to) })));
  }

  @ApiOkResponse({ description: 'accounts and points as they stood before the instant.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('points-outstanding')
  @ApiOperation({ summary: 'Loyalty accounts and the points ledger total before an instant (internal service auth)' })
  pointsOutstanding(@Query() q: AiPointsOutstandingQueryDto): Promise<PointsOutstanding> {
    return this.ai.pointsOutstanding(new Date(q.before));
  }
}
