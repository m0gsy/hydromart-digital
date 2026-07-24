import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { AttendanceService, FacePunch } from '../application/services/attendance.service';
import { FacePunchDto, ListAttendanceDto } from './dto/attendance.dto';
import { decodeBase64Image } from './decode-image';

@ApiTags('HR Attendance')
@ApiBearerAuth()
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // Self-service (PWA): any authenticated staff whose auth account is linked to an
  // employee record. Identity is proven by the face match; ownership by authSubjectId.
  @Post('check-in')
  @ApiOperation({ summary: 'Face check-in (self)' })
  checkIn(@Body() dto: FacePunchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.checkIn(user, this.toPunch(dto));
  }

  @Post('check-out')
  @ApiOperation({ summary: 'Face check-out (self)' })
  checkOut(@Body() dto: FacePunchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.checkOut(user, this.toPunch(dto));
  }

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Attendance log (depot-scoped for depot roles)' })
  list(@Query() query: ListAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.list(user, query);
  }

  private toPunch(dto: FacePunchDto): FacePunch {
    return {
      image: decodeBase64Image(dto.image),
      photoUrl: dto.photoUrl ?? null,
      live: dto.live ?? false,
    };
  }
}
