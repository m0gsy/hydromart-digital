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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { ScheduledReportService } from '../application/services/scheduled-report.service';
import {
  CreateScheduledReportDto,
  ScheduledReportDto,
  UpdateScheduledReportDto,
} from './dto/scheduled-report.dto';

// Design 15c — recurring scheduled reports. HEAD_OFFICE + SUPER_ADMIN. `nextRunAt` is
// advisory metadata for the future scheduler; toggling `enabled` pauses without deleting.
@ApiTags('Scheduled reports')
@ApiBearerAuth()
@Can('hqConsole')
@Controller({ path: 'scheduled-reports', version: '1' })
export class ScheduledReportsController {
  constructor(private readonly reports: ScheduledReportService) {}

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
