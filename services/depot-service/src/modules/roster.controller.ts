import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { RosterService } from '../application/services/roster.service';
import { ShiftAssignment } from '../domain/shift';
import { BulkRosterDto, ListRosterQueryDto, SetShiftDto } from './dto/roster.dto';

/** Courier shift roster (design: operator cell 6d "Jadwal shift kurir" + manager cell 7b). */
@ApiTags('Shift roster')
@ApiBearerAuth()
@Roles(...CAPABILITIES.driverRoster)
@Controller({ path: 'shifts', version: '1' })
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get()
  @ApiOperation({ summary: "A depot's roster cells for one week" })
  week(@Query() query: ListRosterQueryDto): Promise<ShiftAssignment[]> {
    return this.roster.week(query.depotId, query.weekStart);
  }

  @Put()
  @ApiOperation({ summary: 'Set one roster cell (create or overwrite)' })
  setCell(@Body() dto: SetShiftDto): Promise<ShiftAssignment> {
    return this.roster.setCell(dto.depotId, dto.weekStart, dto.staffId, dto.staffName, dto.day, dto.shift);
  }

  @Put('bulk')
  @ApiOperation({ summary: 'Set many roster cells of one week at once' })
  bulk(@Body() dto: BulkRosterDto): Promise<ShiftAssignment[]> {
    return this.roster.bulkSet(dto.depotId, dto.weekStart, dto.cells);
  }
}
