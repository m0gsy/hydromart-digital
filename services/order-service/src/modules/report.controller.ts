import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ReportRange } from '../application/ports/order.repository';
import { ReportService } from '../application/services/report.service';
import {
  AudienceReachQueryDto,
  DepotCompareQueryDto,
  DepotDailyQueryDto,
  DepotMonthlyQueryDto,
  DepotRatingsQueryDto,
  DepotWeeklyQueryDto,
  RangeReportQueryDto,
  ResellerRollupQueryDto,
  SalesReportQueryDto,
  SegmentEstimateQueryDto,
  TopReportQueryDto,
} from './dto/report.dto';
import { CustomerSummary, DepotCompareReport, DepotDailyReport, DepotMonthlyReport, DepotRatingsReport, DepotWeeklyReport, ReportRangeView, ResellerRollupReport, RetentionCohortReport, RevenueByProductReport, SalesReport } from '../application/services/report.service';
import { CustomerSales, DepotRating, DepotRefund, DepotSales, DepotShipping } from '../application/ports/order.repository';
import { AudienceReach3ResponseDto, CustomerResponseDto, DepotCompareReportResponseDto, DepotDailyReportResponseDto, DepotMonthlyReportResponseDto, DepotRatingsReportResponseDto, DepotWeeklyReportResponseDto, RatingByDepotResponseDto, RefundsByDepotResponseDto, ResellerRollupReportResponseDto, RetentionCohortReportResponseDto, RevenueByProductReportResponseDto, SalesReportResponseDto, SegmentEstimate3ResponseDto, ShippingByDepotResponseDto, TopCustomersResponseDto, TopDepotsResponseDto } from './dto/responses.generated.dto';

const REPORT_ROLES = [Role.HEAD_OFFICE, Role.MANAGER, Role.SUPER_ADMIN] as const;
// Depot daily/weekly (2d/7d) are the operator's own console screens, so KEPALA_DEPOT
// joins the reporting roles for these two depot-scoped routes only.
const DEPOT_REPORT_ROLES = [...REPORT_ROLES, Role.KEPALA_DEPOT] as const;
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

  @ApiOkResponse({ type: SalesReportResponseDto })
  @Get('sales')
  @ApiOperation({ summary: 'Daily/monthly sales series (FR-095/096)' })
  sales(@Query() q: SalesReportQueryDto): Promise<SalesReport> {
    return this.reports.sales(q.granularity ?? 'daily', toRange(q));
  }

  @ApiOkResponse({ type: TopCustomersResponseDto })
  @Get('top-customers')
  @ApiOperation({ summary: 'Highest-spending customers (FR-097)' })
  topCustomers(@Query() q: TopReportQueryDto): Promise<ReportRangeView & { items: CustomerSales[] }> {
    return this.reports.topCustomers(toRange(q), q.limit ?? 10);
  }

  @ApiOkResponse({ type: TopDepotsResponseDto })
  @Get('top-depots')
  @ApiOperation({ summary: 'Highest-revenue depots (FR-098)' })
  topDepots(@Query() q: TopReportQueryDto): Promise<ReportRangeView & { items: DepotSales[] }> {
    return this.reports.topDepots(toRange(q), q.limit ?? 10);
  }

  @ApiOkResponse({ type: ShippingByDepotResponseDto })
  @Get('shipping-by-depot')
  @ApiOperation({ summary: 'Shipping (ongkir) billed per depot (reconciliation 22a)' })
  shippingByDepot(@Query() q: RangeReportQueryDto): Promise<ReportRangeView & { items: DepotShipping[] }> {
    return this.reports.shippingByDepot(toRange(q));
  }

  @ApiOkResponse({ type: RefundsByDepotResponseDto })
  @Get('refunds-by-depot')
  @ApiOperation({ summary: 'Refunds settled per depot (reconciliation 22a)' })
  refundsByDepot(@Query() q: RangeReportQueryDto): Promise<ReportRangeView & { items: DepotRefund[] }> {
    return this.reports.refundsByDepot(toRange(q));
  }

  @ApiOkResponse({ type: RatingByDepotResponseDto })
  @Get('rating-by-depot')
  @ApiOperation({ summary: 'Average customer rating per depot (compare 14d)' })
  ratingByDepot(@Query() q: RangeReportQueryDto): Promise<ReportRangeView & { items: DepotRating[] }> {
    return this.reports.ratingByDepot(toRange(q));
  }

  @ApiOkResponse({ type: DepotRatingsReportResponseDto })
  @Get('depot-ratings')
  @ApiOperation({
    summary: "One depot's ratings: average, star distribution, recent reviews (14b)",
  })
  depotRatings(@Query() q: DepotRatingsQueryDto): Promise<DepotRatingsReport> {
    return this.reports.depotRatings(q.depotId, toRange(q));
  }

  @ApiOkResponse({ type: RevenueByProductReportResponseDto })
  @Get('revenue-by-category')
  @ApiOperation({ summary: 'Revenue share per product (22b; per-product — no category column)' })
  revenueByCategory(@Query() q: TopReportQueryDto): Promise<RevenueByProductReport> {
    return this.reports.revenueByProduct(toRange(q), q.limit ?? 10);
  }

  @ApiOkResponse({ type: RetentionCohortReportResponseDto })
  @Get('retention-cohort')
  @ApiOperation({ summary: 'Customer retention by first-order-month cohort (22b)' })
  retentionCohort(@Query() q: RangeReportQueryDto): Promise<RetentionCohortReport> {
    return this.reports.retentionCohort(toRange(q));
  }

  @ApiOkResponse({ type: DepotDailyReportResponseDto })
  @Roles(...DEPOT_REPORT_ROLES)
  @Get('depot-daily')
  @ApiOperation({ summary: 'Depot daily operations report (design 2d Laporan harian)' })
  // H-16 owns the "no date given" default (WIB today), in the service — not here.
  depotDaily(@Query() q: DepotDailyQueryDto): Promise<DepotDailyReport> {
    return this.reports.depotDaily(q.depotId, q.date);
  }

  /**
   * The day's orders, one row each, for the export button on the daily report.
   *
   * Returns rows rather than a rendered file: the console already owns CSV formatting (and
   * the locale that decides the separator), so a server-rendered file would be a second
   * place to keep those rules in step.
   */
  @Roles(...DEPOT_REPORT_ROLES)
  @Get('depot-daily/export')
  @ApiOperation({ summary: "The day's orders behind the daily report, one row per order" })
  depotDailyExport(@Query() q: DepotDailyQueryDto) {
    return this.reports.depotDailyRows(q.depotId, q.date ?? new Date().toISOString().slice(0, 10));
  }

  @ApiOkResponse({ type: DepotWeeklyReportResponseDto })
  @Roles(...DEPOT_REPORT_ROLES)
  @Get('depot-weekly')
  @ApiOperation({ summary: 'Depot weekly operations report (design 7d Laporan mingguan)' })
  depotWeekly(@Query() q: DepotWeeklyQueryDto): Promise<DepotWeeklyReport> {
    return this.reports.depotWeekly(
      q.depotId,
      q.from ? new Date(q.from) : undefined,
      q.to ? new Date(q.to) : undefined,
    );
  }

  @ApiOkResponse({ type: DepotCompareReportResponseDto })
  @Get('depot-compare')
  @ApiOperation({ summary: 'Cross-depot comparison: orders + revenue per depot (design 14d)' })
  depotCompare(@Query() q: DepotCompareQueryDto): Promise<DepotCompareReport> {
    const ids = q.depotIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.reports.reportsDepotCompare(ids, toRange(q));
  }

  @ApiOkResponse({ type: DepotMonthlyReportResponseDto })
  @Get('depot-monthly')
  @ApiOperation({ summary: "One depot's monthly ops review (orders/revenue/active customers)" })
  depotMonthly(@Query() q: DepotMonthlyQueryDto): Promise<DepotMonthlyReport> {
    return this.reports.reportsDepotMonthly(q.depotId, q.month);
  }

  @ApiOkResponse({ type: AudienceReach3ResponseDto })
  @Roles(...AUDIENCE_ROLES)
  @Get('audience-reach')
  @ApiOperation({ summary: 'Opt-in reachable customer count for a broadcast audience (10d)' })
  audienceReach(@Query() q: AudienceReachQueryDto): Promise<{ depotId: string | null; count: number }> {
    return this.reports.audienceReach(q.depotId);
  }

  @ApiOkResponse({ type: SegmentEstimate3ResponseDto })
  @Roles(...AUDIENCE_ROLES)
  @Get('segment-estimate')
  @ApiOperation({
    summary: 'Live size of an activity-based segment: recency/frequency/depot (21d)',
  })
  segmentEstimate(@Query() q: SegmentEstimateQueryDto): Promise<{
    count: number;
    recencyDays: number | null;
    minOrders: number | null;
    depotId: string | null;
  }> {
    return this.reports.segmentEstimate(q);
  }

  @ApiOkResponse({ type: ResellerRollupReportResponseDto })
  @Get('reseller-rollup')
  @ApiOperation({ summary: 'Per-reseller monthly achievement rollup (volume/prev/orders/last)' })
  resellerRollup(@Query() q: ResellerRollupQueryDto): Promise<ResellerRollupReport> {
    const ids = q.customerIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.reports.resellerRollup(q.depotId, q.month, ids);
  }

  @ApiOkResponse({ type: CustomerResponseDto })
  @Roles(...HQ_ROLES)
  @Get('customer/:customerId')
  @ApiOperation({ summary: 'One customer lifetime value + recent orders (17e Customer 360)' })
  customer(@Param('customerId', ParseUUIDPipe) customerId: string): Promise<CustomerSummary> {
    return this.reports.customerSummary(customerId);
  }
}
