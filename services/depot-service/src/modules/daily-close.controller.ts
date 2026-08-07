import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { DailyCloseService, DailyCloseView } from '../application/services/daily-close.service';
import { DailyCloseRecord } from '../application/ports/daily-close.repository';
import {
  DailyCloseRecordResponseDto,
  DailyCloseViewResponseDto,
} from './dto/responses.generated.dto';

/**
 * D-2: a DAY, not any instant. `@IsISO8601()` accepted `2026-08-04T09:00:00Z`, which
 * `close()` carried as far as the `closes.find()` lookup before the window rejected the
 * shape — and `reopen()` never validated it at all. The unique key is
 * `(depotId, businessDate)` on the string itself, so two spellings of one day are two rows.
 */
const BUSINESS_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CloseDayDto {
  @Matches(BUSINESS_DAY, { message: 'businessDate wajib YYYY-MM-DD' })
  businessDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DayQueryDto {
  @Matches(BUSINESS_DAY, { message: 'businessDate wajib YYYY-MM-DD' })
  businessDate!: string;
}

/**
 * "Tutup buku" — a depot declaring one day counted (design 2d, the button that used to do
 * nothing).
 *
 * Closing is the depot's own leadership: they counted the drawer. Reopening is head office,
 * because a depot that can reopen its own books can rewrite a total it already signed off.
 */
@ApiTags('Daily close')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/daily-close', version: '1' })
export class DailyCloseController {
  constructor(private readonly dailyClose: DailyCloseService) {}

  @ApiOkResponse({ type: DailyCloseViewResponseDto })
  @Get()
  @Can('dailyClose')
  @ApiOperation({ summary: "Whether a depot's day is closed, and what arrived after" })
  get(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: DayQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DailyCloseView> {
    return this.dailyClose.get(user, depotId, query.businessDate);
  }

  @ApiOkResponse({ type: DailyCloseRecordResponseDto })
  @Post()
  @Can('dailyClose')
  @ApiOperation({ summary: "Close a depot's books for one day" })
  close(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CloseDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DailyCloseRecord> {
    return this.dailyClose.close(user, depotId, dto.businessDate, dto.note ?? null);
  }

  @ApiOkResponse({ type: DailyCloseRecordResponseDto })
  @Post('reopen')
  @Can('dailyCloseReopen')
  @ApiOperation({ summary: 'Reopen a closed day (head office)' })
  reopen(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: DayQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DailyCloseRecord> {
    return this.dailyClose.reopen(depotId, dto.businessDate, user.sub);
  }
}
