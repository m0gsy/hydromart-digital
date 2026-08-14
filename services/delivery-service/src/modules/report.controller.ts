import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public, addLocalMonths, startOfLocalMonth } from '@hydromart/platform';

import { ReportRange } from '../application/ports/delivery.repository';
import { ReportService } from '../application/services/report.service';
import { DeliveryConfigService } from '../config/delivery-config.service';
import { DepotTeamReportQueryDto, SlaReportQueryDto } from './dto/report.dto';
import { DepotSlaReport, DepotTeamReport, SlaReport } from '../application/services/report.service';
import { DepotSlaReportResponseDto, SlaReportResponseDto } from './dto/responses.generated.dto';

function toRange(q: { from?: string; to?: string }): ReportRange {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  };
}

/**
 * Default window: the WIB calendar month [first-of-month, first-of-next-month).
 *
 * H-16: these were `Date.UTC(...)` bounds, which begin and end at 07:00 WIB — so the
 * default "this month" silently dropped the first seven hours of the 1st and picked up
 * the first seven hours of the next 1st.
 */
function monthWindow(now: Date, timeZone: string): { from: Date; to: Date } {
  const from = startOfLocalMonth(now, timeZone);
  return { from, to: addLocalMonths(from, 1, timeZone) };
}

@ApiTags('Reports')
@ApiBearerAuth()
@Can('deliveryReports')
@Controller({ path: 'reports', version: '1' })
export class ReportController {
  constructor(
    private readonly reports: ReportService,
    private readonly config: DeliveryConfigService,
  ) {}

  @ApiOkResponse({ type: SlaReportResponseDto })
  @Get('sla')
  @ApiOperation({ summary: 'Delivery SLA: on-time vs breached deliveries and failures (M6)' })
  sla(@Query() q: SlaReportQueryDto): Promise<SlaReport> {
    return this.reports.sla(toRange(q), q.thresholdMinutes, q.depotIds);
  }

  /**
   * One depot's on-time rate for order-service's monthly review — the `slaPct` that screen
   * hardcoded to null (S2). order-service holds no delivery timings and must not infer a
   * percentage from order status alone, so it asks the service that measures it.
   *
   * Internal key rather than the class's report roles: the caller is a service composing a
   * report, holding no token. `@Public()` short-circuits RolesGuard, so the class-level
   * @Roles cannot 403 a request that has no identity by design. Declared before the
   * bearer routes so the static `internal` segment wins.
   */
  @ApiOkResponse({ type: SlaReportResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/sla')
  @ApiOperation({ summary: 'On-time SLA for one depot over a window (internal service auth)' })
  internalSla(@Query() q: SlaReportQueryDto): Promise<SlaReport> {
    return this.reports.sla(toRange(q), q.thresholdMinutes, q.depotIds);
  }

  @ApiOkResponse({ type: DepotSlaReportResponseDto })
  @Get('sla-by-depot')
  @ApiOperation({ summary: 'On-time SLA grouped per depot (HQ network roll-up)' })
  slaByDepot(@Query() q: SlaReportQueryDto): Promise<DepotSlaReport> {
    return this.reports.slaByDepot(toRange(q), q.thresholdMinutes);
  }

  @Get('depot-team')
  @ApiOperation({ summary: 'Courier and settlement-operator metrics for one depot' })
  @ApiOkResponse({ description: 'Depot-scoped courier and verified-settlement operator metrics.' })
  depotTeam(@Query() q: DepotTeamReportQueryDto): Promise<DepotTeamReport> {
    const month = monthWindow(new Date(), this.config.businessTimeZone);
    const from = q.from ? new Date(q.from) : month.from;
    const to = q.to ? new Date(q.to) : month.to;
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('from must be before to.');
    }
    return this.reports.depotTeam(q.depotId, from, to);
  }
}
