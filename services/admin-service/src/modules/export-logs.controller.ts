import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { ExportStatus } from '../domain/export';
import { ExportLogService } from '../application/services/export-log.service';
import { ExportLogDto, ExportLogQueryDto, IngestExportLogDto } from './dto/export-log.dto';
import { List3ResponseDto } from './dto/responses.generated.dto';

// Design 13c — data-export audit log. HEAD_OFFICE + SUPER_ADMIN read (paginated,
// newest-first, filter by dataset/status). Ingest is service-to-service (internal key).
@ApiTags('Export logs')
@ApiBearerAuth()
@Controller({ path: 'export-logs', version: '1' })
export class ExportLogsController {
  constructor(private readonly exports: ExportLogService) {}

  @ApiOkResponse({ type: List3ResponseDto })
  @Can('hqConsole')
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

  /**
   * Download the file a scheduled run produced (design 15c).
   *
   * `hq/exports` was a list of claims: the table recorded that an export happened and never
   * held one, because nothing produced a file in the first place. The sweep now stores the
   * bytes on the row, and this is where they come back out.
   */
  @ApiOkResponse({
    description: 'The stored file, as an attachment. Not JSON — no DTO to declare.',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  @Can('hqConsole')
  @Get(':id/download')
  @ApiOperation({ summary: 'Download the file a scheduled report produced (15c)' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.exports.download(id);
    // 404 for "no file", not an empty 200: a zero-byte spreadsheet is the kind of answer
    // somebody forwards to finance before noticing it says nothing.
    if (!file) throw new NotFoundException('Berkas ekspor tidak tersedia.');
    res
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${file.fileName}"`)
      .send(file.content);
  }

  // Service-to-service ingest: an export job records its own run. @Public() bypasses the
  // JWT guard; InternalAuthGuard (shared key) is then the sole, fail-closed auth.
  @ApiOkResponse({ type: ExportLogDto })
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
