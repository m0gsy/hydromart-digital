import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ReportRange } from '../application/ports/order.repository';
import { ReportService } from '../application/services/report.service';
import { RangeReportQueryDto, SalesReportQueryDto, TopReportQueryDto } from './dto/report.dto';

const REPORT_ROLES = [Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
// Customer 360 (17e) is HQ-only — no depot-manager access to a single customer's history.
const HQ_ROLES = [Role.HEAD_OFFICE, Role.SUPER_ADMIN] as const;

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

  @Roles(...HQ_ROLES)
  @Get('customer/:customerId')
  @ApiOperation({ summary: 'One customer lifetime value + recent orders (17e Customer 360)' })
  customer(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.reports.customerSummary(customerId);
  }
}
