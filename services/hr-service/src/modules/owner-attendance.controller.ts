import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { OwnerAttendanceService } from '../application/services/owner-attendance.service';
import { ListAttendanceDto } from './dto/attendance.dto';
import {
  OwnerAttendancePageResponseDto,
  OwnerAttendanceSummaryResponseDto,
  OwnerDepotResponseDto,
  OwnerSummaryQueryDto,
} from './dto/owner-attendance.dto';

/**
 * A franchise owner reading attendance at the depots they own: the log, the face frame behind a
 * punch, and the summary. Read-only; nothing here can approve, adjust or enter a punch.
 *
 * `hrViewOwn` and not `hrView`: `hrView` reads are limited by depot ROLE, so an owner holding it
 * would read every depot. These routes ask depot-service which depots the caller owns, on every
 * call, and refuse the rest.
 */
@ApiTags('HR Attendance (owner)')
@ApiBearerAuth()
@Controller({ path: 'attendance/owner', version: '1' })
export class OwnerAttendanceController {
  constructor(private readonly owner: OwnerAttendanceService) {}

  @ApiOkResponse({ type: [OwnerDepotResponseDto] })
  @Get('depots')
  @Can('hrViewOwn')
  @ApiOperation({ summary: 'The depots the signed-in franchise owner owns' })
  depots(@CurrentUser() user: AuthenticatedUser): Promise<OwnerDepotResponseDto[]> {
    return this.owner.depots(user);
  }

  @ApiOkResponse({ type: OwnerAttendanceSummaryResponseDto })
  @Get('summary')
  @Can('hrViewOwn')
  @ApiOperation({ summary: 'Attendance counts per owned depot for a date range' })
  summary(
    @Query() query: OwnerSummaryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owner.summary(user, query);
  }

  @ApiOkResponse({ type: OwnerAttendancePageResponseDto })
  @Get()
  @Can('hrViewOwn')
  @ApiOperation({ summary: 'Attendance log of the depots the owner owns' })
  list(
    @Query() query: ListAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owner.list(user, query);
  }

  @ApiOkResponse({
    description: 'The stored check-in/check-out frame.',
    content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @Get(':id/photo/:which')
  @Can('hrViewOwn')
  @Header('Cache-Control', 'no-store, private')
  @ApiOperation({ summary: 'The face frame behind a punch at an owned depot (never cached)' })
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('which') which: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (which !== 'in' && which !== 'out') {
      throw new BadRequestException('Foto absensi hanya "in" atau "out"');
    }
    const { body, contentType } = await this.owner.photo(user, id, which);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="absensi-${which}"`);
    return new StreamableFile(body);
  }
}
