import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { HolidayService } from '../application/services/holiday.service';
import { ShiftService } from '../application/services/shift.service';
import {
  CreateAssignmentDto,
  CreateHolidayDto,
  CreateRotationDto,
  CreateShiftDto,
  ListAssignmentDto,
  ListHolidayDto,
  ListShiftDto,
  UpdateRotationDto,
  UpdateShiftDto,
} from './dto/calendar.dto';

/** National/depot holidays that drive the working-day calendar. Read hrView, write hrAdmin. */
@ApiTags('HR Holidays')
@ApiBearerAuth()
@Controller({ path: 'holidays', version: '1' })
export class HolidayController {
  constructor(private readonly holidays: HolidayService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List holidays (depot-scoped for depot roles)' })
  list(@Query() q: ListHolidayDto, @CurrentUser() user: AuthenticatedUser) {
    return this.holidays.list(user, q);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Add a holiday (omit depotId for a national one)' })
  create(@Body() dto: CreateHolidayDto, @CurrentUser() user: AuthenticatedUser) {
    return this.holidays.create(user, dto);
  }

  @Delete(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a holiday' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.holidays.remove(user, id);
  }
}

/** Work-shift definitions (depot start/end). Read hrView, write hrAdmin. */
@ApiTags('HR Shifts')
@ApiBearerAuth()
@Controller({ path: 'hr-shifts', version: '1' })
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List shifts (depot-scoped for depot roles)' })
  list(@Query() q: ListShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.list(user, q.depotId);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Create a shift' })
  create(@Body() dto: CreateShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.create(user, dto);
  }

  @Patch(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Update a shift' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a shift' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.remove(user, id);
  }
}

/**
 * Weekly rotations and who works them (C3). Kept off /hr-shifts so the shift catalogue stays
 * a catalogue — this is the roster.
 */
@ApiTags('HR Shifts')
@ApiBearerAuth()
@Controller({ path: 'shift-rotations', version: '1' })
export class ShiftRotationController {
  constructor(private readonly shifts: ShiftService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List rotations (a depot sees its own plus network-wide ones)' })
  list(@Query() q: ListShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.listRotations(user, q.depotId);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Create a weekly rotation (pattern keyed 0=Sunday .. 6=Saturday)' })
  create(@Body() dto: CreateRotationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.createRotation(user, dto);
  }

  @Patch(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Update a rotation' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.updateRotation(user, id, dto);
  }

  @Get('assignments')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'One employee’s shift assignment history, newest first' })
  listAssignments(@Query() q: ListAssignmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.listAssignments(user, q.employeeId);
  }

  @Post('assignments')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Put an employee on a shift or rotation from a date (append-only)' })
  assign(@Body() dto: CreateAssignmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.assign(user, dto);
  }
}
