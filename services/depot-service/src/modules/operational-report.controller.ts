import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import {
  OperationalCostReport,
  OperationalReportService,
} from '../application/services/operational-report.service';
import { OperationalCostQueryDto } from './dto/operational-report.dto';
import { OperationalCostReportResponseDto } from './dto/responses.generated.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.MANAGER, Role.KEPALA_DEPOT, Role.FINANCE, Role.SUPER_ADMIN)
@Controller({ path: 'reports', version: '1' })
export class OperationalReportController {
  constructor(private readonly reports: OperationalReportService) {}

  @ApiOkResponse({ type: OperationalCostReportResponseDto })
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
