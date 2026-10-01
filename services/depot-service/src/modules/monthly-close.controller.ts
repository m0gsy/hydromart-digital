import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import {
  MonthlyCloseService,
  MonthlyCloseView,
} from '../application/services/monthly-close.service';
import { MonthlyCloseRecord } from '../application/ports/monthly-close.repository';
import {
  MonthlyCloseRecordResponseDto,
  MonthlyCloseViewResponseDto,
} from './dto/responses.generated.dto';

const BUSINESS_MONTH = /^\d{4}-\d{2}$/;

export class CloseMonthDto {
  @Matches(BUSINESS_MONTH, { message: 'businessMonth wajib YYYY-MM' })
  businessMonth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MonthQueryDto {
  @Matches(BUSINESS_MONTH, { message: 'businessMonth wajib YYYY-MM' })
  businessMonth!: string;
}

/**
 * "Tutup bulan" (#17) — a depot sealing a month once every one of its days is already
 * closed (design parallel to daily-close, the button beside it).
 *
 * Same split as the day it wraps: closing is the depot's own leadership, reopening is head
 * office, because a depot that can reopen its own month can rewrite a total it already
 * signed off.
 */
@ApiTags('Monthly close')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/monthly-close', version: '1' })
export class MonthlyCloseController {
  constructor(private readonly monthlyClose: MonthlyCloseService) {}

  @ApiOkResponse({ type: MonthlyCloseViewResponseDto })
  @Get()
  @Can('dailyClose')
  @ApiOperation({ summary: "Whether a depot's month is sealed, and which days still block it" })
  get(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: MonthQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MonthlyCloseView> {
    return this.monthlyClose.get(user, depotId, query.businessMonth);
  }

  @ApiOkResponse({ type: MonthlyCloseRecordResponseDto })
  @Post()
  @Can('dailyClose')
  @ApiOperation({ summary: "Seal a depot's month (every day in it must already be closed)" })
  close(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CloseMonthDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MonthlyCloseRecord> {
    return this.monthlyClose.close(user, depotId, dto.businessMonth, dto.note ?? null);
  }

  @ApiOkResponse({ type: MonthlyCloseRecordResponseDto })
  @Post('reopen')
  @Can('dailyCloseReopen')
  @ApiOperation({ summary: 'Reopen a sealed month (head office)' })
  reopen(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: MonthQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MonthlyCloseRecord> {
    return this.monthlyClose.reopen(depotId, dto.businessMonth, user.sub);
  }
}
