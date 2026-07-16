import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ReportRange } from '../application/ports/order.repository';
import { ReportService } from '../application/services/report.service';
import {
  AudienceReachQueryDto,
  RangeReportQueryDto,
  SalesReportQueryDto,
  SegmentEstimateQueryDto,
  TopReportQueryDto,
} from './dto/report.dto';

const REPORT_ROLES = [Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
// Customer 360 (17e) is HQ-only — no depot-manager access to a single customer's history.
const HQ_ROLES = [Role.HEAD_OFFICE, Role.SUPER_ADMIN] as const;
// Broadcast reach + segment sizing (10d/21d) are marketing-led audience tools.
const AUDIENCE_ROLES = [Role.HEAD_OFFICE, Role.SUPER_ADMIN, Role.MARKETING] as const;

function toRange(q: { from?: string; to?: string }): ReportRange {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  };
}

@ApiTags('Reports')
@ApiBearerAuth()
@Roles(...REPORT_ROLES)
@Controller({ path: 'reports', version: '1' })
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('sales')
  @ApiOperation({ summary: 'Daily/monthly sales series (FR-095/096)' })
  sales(@Query() q: SalesReportQueryDto) {
    return this.reports.sales(q.granularity ?? 'daily', toRange(q));
  }

  @Get('top-customers')
  @ApiOperation({ summary: 'Highest-spending customers (FR-097)' })
  topCustomers(@Query() q: TopReportQueryDto) {
    return this.reports.topCustomers(toRange(q), q.limit ?? 10);
  }

  @Get('top-depots')
  @ApiOperation({ summary: 'Highest-revenue depots (FR-098)' })
  topDepots(@Query() q: TopReportQueryDto) {
    return this.reports.topDepots(toRange(q), q.limit ?? 10);
  }

  @Get('shipping-by-depot')
  @ApiOperation({ summary: 'Shipping (ongkir) billed per depot (reconciliation 22a)' })
  shippingByDepot(@Query() q: RangeReportQueryDto) {
    return this.reports.shippingByDepot(toRange(q));
  }

  @Get('revenue-by-category')
  @ApiOperation({ summary: 'Revenue share per product (22b; per-product — no category column)' })
  revenueByCategory(@Query() q: TopReportQueryDto) {
    return this.reports.revenueByProduct(toRange(q), q.limit ?? 10);
  }

  @Get('retention-cohort')
  @ApiOperation({ summary: 'Customer retention by first-order-month cohort (22b)' })
  retentionCohort(@Query() q: RangeReportQueryDto) {
    return this.reports.retentionCohort(toRange(q));
  }

  @Roles(...AUDIENCE_ROLES)
  @Get('audience-reach')
  @ApiOperation({ summary: 'Opt-in reachable customer count for a broadcast audience (10d)' })
  audienceReach(@Query() q: AudienceReachQueryDto) {
    return this.reports.audienceReach(q.depotId);
  }

  @Roles(...AUDIENCE_ROLES)
  @Get('segment-estimate')
  @ApiOperation({ summary: 'Live size of an activity-based segment: recency/frequency/depot (21d)' })
  segmentEstimate(@Query() q: SegmentEstimateQueryDto) {
    return this.reports.segmentEstimate(q);
  }

  @Roles(...HQ_ROLES)
  @Get('customer/:customerId')
  @ApiOperation({ summary: 'One customer lifetime value + recent orders (17e Customer 360)' })
  customer(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.reports.customerSummary(customerId);
  }
}
