import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { ExportStatus } from '../domain/export';
import { ExportLogService } from '../application/services/export-log.service';
import { ExportLogDto, ExportLogQueryDto, IngestExportLogDto } from './dto/export-log.dto';

// Design 13c — data-export audit log. HEAD_OFFICE + SUPER_ADMIN read (paginated,
// newest-first, filter by dataset/status). Ingest is service-to-service (internal key).
@ApiTags('Export logs')
@ApiBearerAuth()
@Controller({ path: 'export-logs', version: '1' })
export class ExportLogsController {
  constructor(private readonly exports: ExportLogService) {}

  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'List export log entries (13c, paginated, newest first)' })
  async list(@Query() query: ExportLogQueryDto): Promise<{
    items: ExportLogDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = await this.exports.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      dataset: query.dataset,
      status: query.status,
    });
    return { ...result, items: result.items.map(ExportLogDto.from) };
  }

  // Service-to-service ingest: an export job records its own run. @Public() bypasses the
  // JWT guard; InternalAuthGuard (shared key) is then the sole, fail-closed auth.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a data-export run (internal service auth)' })
  async ingest(@Body() dto: IngestExportLogDto): Promise<ExportLogDto> {
    return ExportLogDto.from(
      await this.exports.ingest({
        dataset: dto.dataset,
        requestedById: dto.requestedById ?? null,
        requestedByEmail: dto.requestedByEmail,
        format: dto.format,
        rowCount: dto.rowCount ?? null,
        status: dto.status ?? ExportStatus.PENDING,
      }),
    );
  }
}
