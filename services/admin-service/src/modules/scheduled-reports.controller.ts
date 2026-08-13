import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { ScheduledReportService } from '../application/services/scheduled-report.service';
import {
  ReportSweepResult,
  ScheduledReportRunnerService,
} from '../application/services/scheduled-report-runner.service';
import {
  CreateScheduledReportDto,
  ScheduledReportDto,
  UpdateScheduledReportDto,
} from './dto/scheduled-report.dto';

// Design 15c — recurring scheduled reports. HEAD_OFFICE + SUPER_ADMIN. `nextRunAt` is no
// longer advisory: the sweep below reads it. Toggling `enabled` pauses without deleting.
@ApiTags('Scheduled reports')
@ApiBearerAuth()
@Can('hqConsole')
@Controller({ path: 'scheduled-reports', version: '1' })
export class ScheduledReportsController {
  constructor(
    private readonly reports: ScheduledReportService,
    private readonly runner: ScheduledReportRunnerService,
  ) {}

  /**
   * Produce every report that has come due (design 15c), driven by the scheduler sidecar.
   *
   * `@Public()` bypasses the global JWT guard so InternalAuthGuard is the sole, fail-closed
   * auth — the same shape as every other internal sweep in the repo. Bounded and resumable:
   * whatever this tick does not reach stays due for the next one.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/run-due')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Counts for this tick: schedules due, files produced, failures.' })
  @ApiOperation({ summary: 'Run every due scheduled report (internal service auth)' })
  runDue(): Promise<ReportSweepResult> {
    return this.runner.runDue();
  }

  @ApiOkResponse({ type: ScheduledReportDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List scheduled reports (15c)' })
  async list(): Promise<ScheduledReportDto[]> {
    return (await this.reports.list()).map((r) => ScheduledReportDto.from(r));
  }

  @ApiOkResponse({ type: ScheduledReportDto })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a scheduled report' })
  async create(@Body() dto: CreateScheduledReportDto): Promise<ScheduledReportDto> {
    return ScheduledReportDto.from(await this.reports.create(dto));
  }

  @ApiOkResponse({ type: ScheduledReportDto })
  @Patch(':id')
  @ApiOperation({ summary: 'Enable / disable / edit a scheduled report' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateScheduledReportDto,
  ): Promise<ScheduledReportDto> {
    return ScheduledReportDto.from(await this.reports.update(id, dto));
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a scheduled report' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.reports.remove(id);
  }
}
