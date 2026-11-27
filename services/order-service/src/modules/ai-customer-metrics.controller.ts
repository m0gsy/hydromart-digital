import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { AiSpan } from '../application/ports/ai-customer.repository';
import { AiCustomerMetricsService } from '../application/services/ai-customer-metrics.service';
import { AiCustomerMetricsDto, AiLiveOrdersQueryDto, AiSegmentsDto, AiSpanDto, AiSpansDto } from './dto/ai-customer.dto';

const toSpans = (spans: AiSpanDto[]): AiSpan[] =>
  spans.map((s) => ({ depotId: s.depotId, from: new Date(s.from), to: new Date(s.to) }));

/**
 * HD-6 H3: customer, rating and gallon facts for the AI read API (dashboard-service). Internal key
 * only; the caller has already narrowed what the asker may read to spans (a depot and the instants
 * it was readable), and these answer for exactly those. No route returns a customer id, name,
 * phone or address: only counts.
 */
@ApiTags('Reports')
@Controller({ path: 'reports/internal', version: '1' })
export class AiCustomerMetricsController {
  constructor(private readonly metrics: AiCustomerMetricsService) {}

  @ApiOkResponse({ description: 'active, newCustomers, repeat and newAtDepot: distinct named customers.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('customer-metrics')
  @HttpCode(200)
  @ApiOperation({ summary: 'New, active and repeat customers over spans (internal service auth)' })
  customers(@Body() body: AiCustomerMetricsDto) {
    return this.metrics.customers(toSpans(body.spans), new Date(body.periodFrom));
  }

  @ApiOkResponse({ description: 'points: k (a number within this answer, never an id), lat, lng, orders, galon, one per customer per pin; unlocated: customers, orders, galon without a pin. 422 past the cap.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('area-points')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delivery pins of the counted orders over spans, anonymous (internal service auth)' })
  areaPoints(@Body() body: AiSpansDto) {
    return this.metrics.areaPoints(toSpans(body.spans));
  }

  @ApiOkResponse({ description: 'cells: cohort, monthIndex, customers.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('customer-cohorts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retention cohorts by lifetime first-order month over spans (internal service auth)' })
  async cohorts(@Body() body: AiSpansDto) {
    return { cells: await this.metrics.cohorts(toSpans(body.spans)) };
  }

  @ApiOkResponse({ description: 'reviews, ratingSum, reviewers.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('rating-metrics')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reviews, star sum and distinct reviewers over spans (internal service auth)' })
  ratings(@Body() body: AiSpansDto) {
    return this.metrics.ratings(toSpans(body.spans));
  }

  @ApiOkResponse({ description: 'active, atRisk, inactive by days since the last order.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('customer-segments')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customers by recency of their last order (internal service auth)' })
  segments(@Body() body: AiSegmentsDto) {
    return this.metrics.segments(body.depotIds.split(','), {
      riskSince: new Date(body.riskSince),
      activeSince: new Date(body.activeSince),
      until: new Date(body.until),
    });
  }

  @ApiOkResponse({ description: 'gallons: gallon units on DELIVERED or COMPLETED orders created in the spans; byDepot: the same per depot (a depot that sold none is absent).' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('gallon-metrics')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gallons sold over spans (internal service auth)' })
  gallons(@Body() body: AiSpansDto) {
    return this.metrics.gallons(toSpans(body.spans));
  }

  @ApiOkResponse({ description: 'refill, partial, beli, notAsked: counter gallon sales by empties brought.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('refill-split')
  @HttpCode(200)
  @ApiOperation({ summary: 'Counter refill vs new-gallon sales over spans (internal service auth)' })
  refill(@Body() body: AiSpansDto) {
    return this.metrics.refill(toSpans(body.spans));
  }

  @ApiOkResponse({ description: 'cancelled: delivery orders cancelled in the spans that never left the depot.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('cancelled-before-departure')
  @HttpCode(200)
  @ApiOperation({ summary: 'Orders cancelled before departure over spans (internal service auth)' })
  cancelledBeforeDeparture(@Body() body: AiSpansDto) {
    return this.metrics.cancelledBeforeDeparture(toSpans(body.spans));
  }

  @ApiOkResponse({ description: 'byStatus: status and count, for orders still moving.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('live-orders')
  @ApiOperation({ summary: 'Orders in flight now, per status (internal service auth)' })
  live(@Query() q: AiLiveOrdersQueryDto) {
    return this.metrics.live(q.depotIds.split(','));
  }
}
