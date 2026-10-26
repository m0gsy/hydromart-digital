import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public } from '@hydromart/platform';

import {
  OperationalCostReport,
  OperationalReportService,
} from '../application/services/operational-report.service';
import {
  DepotGovernance,
  DepotGovernanceService,
} from '../application/services/depot-governance.service';
import { ReportTable, ReportTableService } from '../application/services/report-table.service';
import { ReportTableQueryDto } from './dto/report-table.dto';
import { OperationalCostQueryDto } from './dto/operational-report.dto';
import { DepotGovernanceQueryDto } from './dto/depot-governance.dto';
import {
  DepotGovernanceResponseDto,
  OperationalCostReportResponseDto,
} from './dto/responses.generated.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Can('depotOperationalReport')
@Controller({ path: 'reports', version: '1' })
export class OperationalReportController {
  constructor(
    private readonly reports: OperationalReportService,
    private readonly governance: DepotGovernanceService,
    private readonly tables: ReportTableService,
  ) {}

  /**
   * The governance panel of one depot's monthly review, for order-service. Internal key
   * rather than a staff capability: the caller is a service composing a report and holds no
   * token for this depot's staff. `@Public()` short-circuits RolesGuard so the class-level
   * @Roles cannot 403 a request that is deliberately identity-less, and it is declared FIRST
   * so the static `internal` segment wins.
   */
  @ApiOkResponse({ type: DepotGovernanceResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/governance')
  @ApiOperation({ summary: "One depot's approval/opname/settlement figures (internal)" })
  async governanceInRange(@Query() query: DepotGovernanceQueryDto): Promise<DepotGovernance> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from >= to) throw new BadRequestException('from must be earlier than to');
    return this.governance.inRange(query.depotId, from, to);
  }

  /**
   * A table for admin-service's scheduled-report sweep. Internal key: the caller is cron and
   * holds no bearer. Only the datasets this service owns are accepted — anything else is a
   * 400 from the DTO rather than an empty file.
   */
  @ApiOkResponse({ description: '`{ columns, rows, truncated }` — the scheduled-report table shape.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/report-table')
  @ApiOperation({ summary: 'A scheduled report table (internal service auth)' })
  async reportTable(@Query() query: ReportTableQueryDto): Promise<ReportTable> {
    if (new Date(query.from) >= new Date(query.to)) {
      throw new BadRequestException('from must be earlier than to');
    }
    return this.tables.stockLevels();
  }

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
