import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ReportRange } from '../application/ports/delivery.repository';
import { ReportService } from '../application/services/report.service';
import { SlaReportQueryDto } from './dto/report.dto';

const REPORT_ROLES = [Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

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

  @Get('sla')
  @ApiOperation({ summary: 'Delivery SLA: on-time vs breached deliveries and failures (M6)' })
  sla(@Query() q: SlaReportQueryDto) {
    return this.reports.sla(toRange(q), q.thresholdMinutes, q.depotIds);
  }
}
