import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Role,
  Roles,
  assertDepotAccess,
} from '@hydromart/platform';

import { ReportRange } from '../application/ports/order.repository';
import { ReportService } from '../application/services/report.service';
import {
  AudienceReachQueryDto,
  DepotCompareQueryDto,
  DepotDailyGallonsQueryDto,
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
import {
  InternalDailySalesBroadcastResponseDto,
  InternalDepotDailyGallonsResponseDto,
  InternalSegmentCustomersResponseDto,
} from './dto/responses.generated.dto';
import { AudienceReach3ResponseDto, CustomerResponseDto, DepotCompareReportResponseDto, DepotDailyReportResponseDto, DepotDailyRowResponseDto, DepotMonthlyReportResponseDto, DepotRatingsReportResponseDto, DepotWeeklyReportResponseDto, RatingByDepotResponseDto, RefundsByDepotResponseDto, ResellerRollupReportResponseDto, RetentionCohortReportResponseDto, RevenueByProductReportResponseDto, SalesReportResponseDto, SegmentEstimate3ResponseDto, ShippingByDepotResponseDto, TopCustomersResponseDto, TopDepotsResponseDto } from './dto/responses.generated.dto';

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
   *
   * B-8: `depotId` comes from the client and `DEPOT_REPORT_ROLES` includes KEPALA_DEPOT, so
   * this is checked against the CALLER. The neighbouring `depot-daily` has the same hole and
   * is left alone — that is main's surface — but it returns aggregates, while this returns
   * every customer's name and every courier's name for a day. Widening one depot's report
   * into another depot's customer list is a different order of mistake.
   */
  @ApiOkResponse({ type: DepotDailyRowResponseDto, isArray: true })
  @Roles(...DEPOT_REPORT_ROLES)
  @Get('depot-daily/export')
  @ApiOperation({ summary: "The day's orders behind the daily report, one row per order" })
  // Same as depotDaily above: the "no date given" default is WIB today, decided in the
  // service. A `new Date().toISOString().slice(0,10)` here would be the UTC today, and
  // before 07:00 WIB the export would offer a different day than the screen it sits on.
  depotDailyExport(@Query() q: DepotDailyQueryDto, @CurrentUser() user: AuthenticatedUser) {
    assertDepotAccess(user, q.depotId);
    return this.reports.depotDailyRows(q.depotId, q.date);
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

  /**
   * Gallons delivered per local day, for hr-service's daily sales bonus (depot SOP).
   *
   * No end-user token — the caller is a payroll run, authenticated by the shared
   * INTERNAL_SERVICE_KEY. `@Public()` is required because this controller carries a
   * class-level `@Roles(...)`; InternalAuthGuard is then the sole (fail-closed) auth.
   */
  @ApiOkResponse({ type: InternalDepotDailyGallonsResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-daily-gallons')
  @ApiOperation({ summary: 'Gallons delivered per local day for a depot (internal service auth)' })
  async internalDepotDailyGallons(
    @Query() q: DepotDailyGallonsQueryDto,
  ): Promise<{ depotId: string; days: { day: string; gallons: number }[] }> {
    return {
      depotId: q.depotId,
      days: await this.reports.depotDailyGallons(q.depotId, q.from, q.to),
    };
  }

  /**
   * Who is in an activity segment — the audience crm broadcasts to (design 21d).
   *
   * Internal-key only, and deliberately not a bearer route: the caller is crm resolving a
   * campaign audience, and the customers it gets back are a mailing list, not a report a
   * console should be able to page through. `truncated` says the segment outgrew the cap,
   * so crm can refuse rather than message part of it.
   */
  @ApiOkResponse({ type: InternalSegmentCustomersResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/segment-customers')
  @ApiOperation({ summary: 'Customer ids in an activity segment (internal service auth)' })
  internalSegmentCustomers(
    @Query() q: SegmentEstimateQueryDto,
  ): Promise<{ customerIds: string[]; truncated: boolean }> {
    return this.reports.segmentCustomers(q);
  }

  /**
   * Depot SOP: the twice-daily sales update, fired by cron (13:00 and 18:00 WIB).
   *
   * Internal-key only, like the gallon aggregate above — the caller is a scheduler, not a
   * signed-in user. Returns the counts so the cron log says what actually went out.
   */
  @ApiOkResponse({ type: InternalDailySalesBroadcastResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/daily-sales-broadcast/:slot')
  @ApiOperation({ summary: "Send each depot today's gallon count (internal service auth)" })
  internalDailySalesBroadcast(
    // A path segment, not a body: `sweep.sh` posts `--post-data=''` with no content-type,
    // so a body DTO would arrive empty and 400 on every cron tick. It also gives the two
    // slots separate sweep locks, which is what you want — siang must not block sore.
    @Param('slot') slot: string,
  ): Promise<{ attempted: number; skipped: number }> {
    if (slot !== 'siang' && slot !== 'sore') {
      throw new BadRequestException('slot must be siang or sore');
    }
    return this.reports.broadcastDailySales(slot);
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
