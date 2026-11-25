import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import { AnswerEnvelope } from '../application/ai-read/envelope';
import { LOYALTY_METRICS, LoyaltyMetricsService } from '../application/ai-read/loyalty-metrics';
import { assertSplittable } from '../application/ai-read/split';
import { STOCK_METRICS, StockMetricsService } from '../application/ai-read/stock-metrics';
import { AnswerEnvelopeDto } from './dto/ai-read.dto';
import { LoyaltyQueryDto, StockQueryDto } from './dto/ai-read-stock.dto';

/**
 * HD-6 H4: stock, purchasing, water meter and forecast (S-), and loyalty, referral, promo,
 * subscriptions, campaigns and open queues (O-, A-). One route per group, the metric id in the
 * `metric` query, the same envelope as every other read route.
 */
@ApiTags('AI read')
@ApiBearerAuth()
@Controller({ path: 'ai/read', version: '1' })
export class AiReadStockController {
  constructor(
    private readonly stock: StockMetricsService,
    private readonly loyalty: LoyaltyMetricsService,
  ) {}

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('stock')
  @ApiOperation({ summary: 'One stock metric (stock, count differences, wastage, water meter, purchasing, forecast)' })
  stockMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: StockQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    assertSplittable(metric, period, STOCK_METRICS);
    return this.stock.answer(metric, user, period);
  }

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('loyalty')
  @ApiOperation({ summary: 'One loyalty, referral, promo, subscription, campaign or open-queue metric' })
  loyaltyMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: LoyaltyQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    assertSplittable(metric, period, LOYALTY_METRICS);
    return this.loyalty.answer(metric, user, period);
  }
}
