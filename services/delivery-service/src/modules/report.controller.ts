import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ReportRange } from '../application/ports/delivery.repository';
import { ReportService } from '../application/services/report.service';
import { DepotTeamReportQueryDto, SlaReportQueryDto } from './dto/report.dto';

const REPORT_ROLES = [Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

function toRange(q: { from?: string; to?: string }): ReportRange {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  };
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

@ApiTags('Reports')
@ApiBearerAuth()
@Roles(...REPORT_ROLES)
@Controller({ path: 'reports', version: '1' })
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('sla')
  @ApiOperation({ summary: 'Delivery SLA: on-time vs breached deliveries and failures (M6)' })
  sla(@Query() q: SlaReportQueryDto) {
    return this.reports.sla(toRange(q), q.thresholdMinutes, q.depotIds);
  }

  @Get('sla-by-depot')
  @ApiOperation({ summary: 'On-time SLA grouped per depot (HQ network roll-up)' })
  slaByDepot(@Query() q: SlaReportQueryDto) {
    return this.reports.slaByDepot(toRange(q), q.thresholdMinutes);
  }

  @Get('depot-team')
  @ApiOperation({ summary: 'Courier and settlement-operator metrics for one depot' })
  @ApiOkResponse({ description: 'Depot-scoped courier and verified-settlement operator metrics.' })
  depotTeam(@Query() q: DepotTeamReportQueryDto) {
    const now = new Date();
    const from = q.from ? new Date(q.from) : monthStart(now);
    const to = q.to ? new Date(q.to) : nextMonthStart(now);
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('from must be before to.');
    }
    return this.reports.depotTeam(q.depotId, from, to);
  }
}
