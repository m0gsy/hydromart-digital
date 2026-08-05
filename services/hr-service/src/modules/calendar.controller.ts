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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

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
import { Holiday, Shift, ShiftAssignment, ShiftRotation } from '../../prisma/generated/client';
import { HolidayResponseDto, ShiftAssignmentResponseDto, ShiftResponseDto, ShiftRotationResponseDto } from './dto/responses.generated.dto';

/** National/depot holidays that drive the working-day calendar. Read hrView, write hrAdmin. */
@ApiTags('HR Holidays')
@ApiBearerAuth()
@Controller({ path: 'holidays', version: '1' })
export class HolidayController {
  constructor(private readonly holidays: HolidayService) {}

  @ApiOkResponse({ type: HolidayResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List holidays (depot-scoped for depot roles)' })
  list(@Query() q: ListHolidayDto, @CurrentUser() user: AuthenticatedUser): Promise<Holiday[]> {
    return this.holidays.list(user, q);
  }

  @ApiOkResponse({ type: HolidayResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Add a holiday (omit depotId for a national one)' })
  create(@Body() dto: CreateHolidayDto, @CurrentUser() user: AuthenticatedUser): Promise<Holiday> {
    return this.holidays.create(user, dto);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @Can('hrAdmin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a holiday' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.holidays.remove(user, id);
  }
}

/** Work-shift definitions (depot start/end). Read hrView, write hrAdmin. */
@ApiTags('HR Shifts')
@ApiBearerAuth()
@Controller({ path: 'hr-shifts', version: '1' })
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @ApiOkResponse({ type: ShiftResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List shifts (depot-scoped for depot roles)' })
  list(@Query() q: ListShiftDto, @CurrentUser() user: AuthenticatedUser): Promise<Shift[]> {
    return this.shifts.list(user, q.depotId);
  }

  @ApiOkResponse({ type: ShiftResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create a shift' })
  create(@Body() dto: CreateShiftDto, @CurrentUser() user: AuthenticatedUser): Promise<Shift> {
    return this.shifts.create(user, dto);
  }

  @ApiOkResponse({ type: ShiftResponseDto })
  @Patch(':id')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Update a shift' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Shift> {
    return this.shifts.update(user, id, dto);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @Can('hrAdmin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a shift' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
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

  @ApiOkResponse({ type: ShiftRotationResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List rotations (a depot sees its own plus network-wide ones)' })
  list(@Query() q: ListShiftDto, @CurrentUser() user: AuthenticatedUser): Promise<ShiftRotation[]> {
    return this.shifts.listRotations(user, q.depotId);
  }

  @ApiOkResponse({ type: ShiftRotationResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create a weekly rotation (pattern keyed 0=Sunday .. 6=Saturday)' })
  create(@Body() dto: CreateRotationDto, @CurrentUser() user: AuthenticatedUser): Promise<ShiftRotation> {
    return this.shifts.createRotation(user, dto);
  }

  @ApiOkResponse({ type: ShiftRotationResponseDto })
  @Patch(':id')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Update a rotation' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftRotation> {
    return this.shifts.updateRotation(user, id, dto);
  }

  @ApiOkResponse({ type: ShiftAssignmentResponseDto, isArray: true })
  @Get('assignments')
  @Can('hrView')
  @ApiOperation({ summary: 'One employee’s shift assignment history, newest first' })
  listAssignments(@Query() q: ListAssignmentDto, @CurrentUser() user: AuthenticatedUser): Promise<ShiftAssignment[]> {
    return this.shifts.listAssignments(user, q.employeeId);
  }

  @ApiOkResponse({ type: ShiftAssignmentResponseDto })
  @Post('assignments')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Put an employee on a shift or rotation from a date (append-only)' })
  assign(@Body() dto: CreateAssignmentDto, @CurrentUser() user: AuthenticatedUser): Promise<ShiftAssignment> {
    return this.shifts.assign(user, dto);
  }
}
