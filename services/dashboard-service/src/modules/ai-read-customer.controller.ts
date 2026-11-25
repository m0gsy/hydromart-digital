import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import { CUSTOMER_METRICS, CustomerMetricsService } from '../application/ai-read/customer-metrics';
import { DELIVERY_METRICS, DeliveryMetricsService } from '../application/ai-read/delivery-metrics';
import { AnswerEnvelope } from '../application/ai-read/envelope';
import { GALLON_METRICS, GallonMetricsService } from '../application/ai-read/gallon-metrics';
import { assertSplittable } from '../application/ai-read/split';
import { TARGET_METRICS, TargetMetricsService } from '../application/ai-read/target-metrics';
import { AnswerEnvelopeDto } from './dto/ai-read.dto';
import { CustomerQueryDto, DeliveryQueryDto, GallonQueryDto, TargetQueryDto } from './dto/ai-read-customer.dto';

/**
 * HD-6 H3: customers (C-), delivery and couriers (K-) and gallons (G-). One route per group, the
 * metric id in the `metric` query, the same envelope as every other read route. No route returns a
 * name, phone or address: customers and couriers appear as counts only, and a group of fewer than 3
 * people is held back.
 */
@ApiTags('AI read')
@ApiBearerAuth()
@Controller({ path: 'ai/read', version: '1' })
export class AiReadCustomerController {
  constructor(
    private readonly customers: CustomerMetricsService,
    private readonly delivery: DeliveryMetricsService,
    private readonly gallons: GallonMetricsService,
    private readonly targets: TargetMetricsService,
  ) {}

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('customers')
  @ApiOperation({ summary: 'One customer metric (new, active, repeat, segments, cohorts, rating) for a whole month' })
  customerMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: CustomerQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    assertSplittable(metric, period, CUSTOMER_METRICS);
    return this.customers.answer(metric, user, period);
  }

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('delivery')
  @ApiOperation({ summary: 'One delivery or courier metric (delivered, on time, median time, failed, team, live orders)' })
  deliveryMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: DeliveryQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    assertSplittable(metric, period, DELIVERY_METRICS);
    return this.delivery.answer(metric, user, period);
  }

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('gallons')
  @ApiOperation({ summary: 'One gallon metric (sold, at customers, deposit, returned, refill split)' })
  gallonMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: GallonQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    assertSplittable(metric, period, GALLON_METRICS);
    return this.gallons.answer(metric, user, period);
  }

  /** HD-16: the monthly goals a depot manager sets, beside the actual of the metric that measures each. */
  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('targets')
  @ApiOperation({ summary: 'Target versus actual for one whole month (revenue, gallons, orders, new customers)' })
  targetMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: TargetQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    assertSplittable(metric, period, TARGET_METRICS);
    return this.targets.answer(metric, user, period);
  }
}
