import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { AttendanceResponseDto, ListSelf3ResponseDto } from './dto/responses.generated.dto';

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
