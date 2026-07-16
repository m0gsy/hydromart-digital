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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

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
@Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
@Controller({ path: 'scheduled-reports', version: '1' })
export class ScheduledReportsController {
  constructor(private readonly reports: ScheduledReportService) {}

  @Get()
  @ApiOperation({ summary: 'List scheduled reports (15c)' })
  async list(): Promise<ScheduledReportDto[]> {
    return (await this.reports.list()).map((r) => ScheduledReportDto.from(r));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a scheduled report' })
  async create(@Body() dto: CreateScheduledReportDto): Promise<ScheduledReportDto> {
    return ScheduledReportDto.from(await this.reports.create(dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Enable / disable / edit a scheduled report' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateScheduledReportDto,
  ): Promise<ScheduledReportDto> {
    return ScheduledReportDto.from(await this.reports.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a scheduled report' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.reports.remove(id);
  }
}
