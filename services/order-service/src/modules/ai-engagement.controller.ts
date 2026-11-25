import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { DiscountTotals, NewSubscriptions } from '../application/ports/ai-engagement.repository';
import { AiEngagementService } from '../application/services/ai-engagement.service';
import { AiDiscountsDto, AiSubscriptionWindowDto } from './dto/ai-engagement.dto';

/**
 * HD-6 H4 part 2: discount and subscription facts for the AI read API (dashboard-service, internal key
 * only). No route returns a customer id, a name, a phone or an address: only counts and sums.
 */
@ApiTags('Reports')
@Controller({ path: 'reports/internal', version: '1' })
export class AiEngagementController {
  constructor(private readonly ai: AiEngagementService) {}

  @ApiOkResponse({ description: 'orders, discountedOrders and discountIdr over the spans.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('discount-metrics')
  @HttpCode(200)
  @ApiOperation({ summary: 'Order-level discounts on counted orders over depot spans (internal service auth)' })
  discounts(@Body() body: AiDiscountsDto): Promise<DiscountTotals> {
    return this.ai.discounts(body.spans.map((s) => ({ depotId: s.depotId, from: new Date(s.from), to: new Date(s.to) })));
  }

  @ApiOkResponse({ description: 'subscriptions and subscribers made inside the window, network-wide.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('subscription-metrics')
  @ApiOperation({ summary: 'Subscriptions made inside a window (internal service auth)' })
  subscriptions(@Query() q: AiSubscriptionWindowDto): Promise<NewSubscriptions> {
    return this.ai.newSubscriptions(new Date(q.from), new Date(q.to));
  }
}
