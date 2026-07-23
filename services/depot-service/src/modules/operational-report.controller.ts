import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import {
  OperationalCostReport,
  OperationalReportService,
} from '../application/services/operational-report.service';
import { OperationalCostQueryDto } from './dto/operational-report.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.DEPOT_OPERATOR, Role.FINANCE, Role.SUPER_ADMIN)
@Controller({ path: 'reports', version: '1' })
export class OperationalReportController {
  constructor(private readonly reports: OperationalReportService) {}

  @Get('operational-costs')
  @ApiOperation({
    summary: 'Depot operational COGS/opex report with explicit source coverage (non-statutory)',
  })
  async costs(@Query() query: OperationalCostQueryDto): Promise<OperationalCostReport> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from >= to) throw new BadRequestException('from must be earlier than to');
    return this.reports.report(query.depotId, { from, to });
  }
}
