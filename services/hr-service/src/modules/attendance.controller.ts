import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { AttendanceService, FacePunch } from '../application/services/attendance.service';
import {
  AdjustAttendanceDto,
  DecideAttendanceDto,
  FacePunchDto,
  ListAttendanceDto,
  ManualAttendanceDto,
} from './dto/attendance.dto';
import { decodeBase64Image } from './decode-image';
import { Attendance } from '../../prisma/generated/client';
import {
  AttendanceAdjustmentResponseDto,
  AttendanceResponseDto,
  ListSelf3ResponseDto,
} from './dto/responses.generated.dto';
import { AttendanceAdjustmentRecord } from '../application/ports/attendance.repository';

@ApiTags('HR Attendance')
@ApiBearerAuth()
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // Self-service (PWA): any authenticated staff whose auth account is linked to an
  // employee record. Identity is proven by the face match; ownership by authSubjectId.
  @ApiOkResponse({ type: AttendanceResponseDto })
  @Post('check-in')
  @ApiOperation({ summary: 'Face check-in (self)' })
  checkIn(@Body() dto: FacePunchDto, @CurrentUser() user: AuthenticatedUser): Promise<Attendance> {
    return this.attendance.checkIn(user, this.toPunch(dto));
  }

  @ApiOkResponse({ type: AttendanceResponseDto })
  @Post('check-out')
  @ApiOperation({ summary: 'Face check-out (self)' })
  checkOut(@Body() dto: FacePunchDto, @CurrentUser() user: AuthenticatedUser): Promise<Attendance> {
    return this.attendance.checkOut(user, this.toPunch(dto));
  }

  @ApiOkResponse({ type: ListSelf3ResponseDto })
  @Get('me')
  @ApiOperation({ summary: 'My attendance log (self)' })
  listSelf(@Query() query: ListAttendanceDto, @CurrentUser() user: AuthenticatedUser): Promise<{ rows: Attendance[]; total: number; page: number; pageSize: number }> {
    return this.attendance.listSelf(user, query);
  }

  @ApiOkResponse({ type: ListSelf3ResponseDto })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'Attendance log (depot-scoped for depot roles)' })
  list(@Query() query: ListAttendanceDto, @CurrentUser() user: AuthenticatedUser): Promise<{ rows: Attendance[]; total: number; page: number; pageSize: number }> {
    return this.attendance.list(user, query);
  }

  @ApiOkResponse({ type: AttendanceResponseDto })
  @Post('manual')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Manual attendance entry (LEAVE/HOLIDAY/ABSENT) for a day' })
  createManual(@Body() dto: ManualAttendanceDto, @CurrentUser() user: AuthenticatedUser): Promise<Attendance> {
    return this.attendance.createManual(user, dto);
  }

  /**
   * CA-1-24: the corrections filed against one attendance row, newest first.
   *
   * `hrAdmin`, the same capability that may MAKE a correction — reading who changed
   * somebody's attendance and why is no less sensitive than making the change.
   */
  @ApiOkResponse({ type: AttendanceAdjustmentResponseDto, isArray: true })
  @Get(':id/adjustments')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Corrections filed against one attendance row (audited trail)' })
  adjustments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendanceAdjustmentRecord[]> {
    return this.attendance.listAdjustments(user, id);
  }

  /**
   * CA-1-66: the selfie the punch was accepted on.
   *
   * `hrView`, like every other read of somebody's attendance, and never cached — the same
   * rule the document route follows, for the same reason: a face frame is personal data
   * under UU 27/2022 and must not survive in a proxy or a WebView cache.
   */
  @ApiOkResponse({
    description: 'The stored check-in/check-out frame.',
    content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @Get(':id/photo/:which')
  @Can('hrView')
  @Header('Cache-Control', 'no-store, private')
  @ApiOperation({ summary: 'The face frame captured with a punch (authenticated; never cached)' })
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('which') which: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (which !== 'in' && which !== 'out') {
      throw new BadRequestException('Foto absensi hanya "in" atau "out"');
    }
    const { body, contentType } = await this.attendance.photo(user, id, which);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="absensi-${which}"`);
    return new StreamableFile(body);
  }

  @ApiOkResponse({ type: AttendanceResponseDto })
  @Patch(':id/adjust')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Correct an attendance row (audited)' })
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Attendance> {
    return this.attendance.adjust(user, id, dto);
  }

  @ApiOkResponse({ type: AttendanceResponseDto })
  @Patch(':id/decide')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Approve or reject an offline punch waiting for HR (audited)' })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Attendance> {
    return this.attendance.decide(user, id, dto.decision, dto.note);
  }

  private toPunch(dto: FacePunchDto): FacePunch {
    return {
      image: decodeBase64Image(dto.image),
      photoUrl: dto.photoUrl ?? null,
      lat: dto.lat,
      lng: dto.lng,
      capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : null,
    };
  }
}
