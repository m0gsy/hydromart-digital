import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { ShiftService, ShiftView } from '../application/services/shift.service';
import { CheckInDto, CheckOutDto, SetShiftStatusDto } from './dto/shift.dto';

/** Courier-facing shift: check in at the depot, go on break, check out (design 3a/3b). */
@ApiTags('Driver Shifts')
@ApiBearerAuth()
@Roles(Role.DRIVER)
@Controller({ path: 'driver/shifts', version: '1' })
export class DriverShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Get('current')
  @ApiOperation({ summary: "The courier's open shift, or null when checked out" })
  current(@CurrentUser() user: AuthenticatedUser): Promise<ShiftView | null> {
    return this.shifts.current(user.sub);
  }

  @Get()
  @ApiOperation({ summary: "The courier's recent shifts, newest first" })
  history(@CurrentUser() user: AuthenticatedUser): Promise<ShiftView[]> {
    return this.shifts.history(user.sub);
  }

  @Post('check-in')
  @ApiOperation({ summary: 'Start a shift (verified against the depot location)' })
  checkIn(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckInDto): Promise<ShiftView> {
    return this.shifts.checkIn(user.sub, dto.depotId, dto.lat, dto.lng);
  }

  @Post(':id/check-out')
  @ApiOperation({ summary: 'End the shift' })
  checkOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckOutDto,
  ): Promise<ShiftView> {
    return this.shifts.checkOut(user.sub, id, dto.lat, dto.lng);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Go ONLINE / BREAK / OFFLINE' })
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetShiftStatusDto,
  ): Promise<ShiftView> {
    return this.shifts.setStatus(user.sub, id, dto.status);
  }
}
