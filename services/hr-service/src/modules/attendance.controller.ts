import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { AttendanceService, FacePunch } from '../application/services/attendance.service';
import { AdjustAttendanceDto, FacePunchDto, ListAttendanceDto, ManualAttendanceDto } from './dto/attendance.dto';
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

  @Get('me')
  @ApiOperation({ summary: 'My attendance log (self)' })
  listSelf(@Query() query: ListAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.listSelf(user, query);
  }

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'Attendance log (depot-scoped for depot roles)' })
  list(@Query() query: ListAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.list(user, query);
  }

  @Post('manual')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Manual attendance entry (LEAVE/HOLIDAY/ABSENT) for a day' })
  createManual(@Body() dto: ManualAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.createManual(user, dto);
  }

  @Patch(':id/adjust')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Correct an attendance row (audited)' })
  adjust(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.adjust(user, id, dto);
  }

  private toPunch(dto: FacePunchDto): FacePunch {
    return {
      image: decodeBase64Image(dto.image),
      photoUrl: dto.photoUrl ?? null,
      live: dto.live ?? false,
    };
  }
}
