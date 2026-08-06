import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { RosterService } from '../application/services/roster.service';
import { ShiftAssignment } from '../domain/shift';
import { BulkRosterDto, ListRosterQueryDto, SetShiftDto } from './dto/roster.dto';
import { ShiftAssignmentResponseDto } from './dto/responses.generated.dto';

/**
 * Courier shift roster (design: operator cell 6d "Jadwal shift kurir" + manager cell 7b).
 *
 * B1: every route passes the CALLER down. `driverRoster` is held by KEPALA_DEPOT and
 * MANAGER, both bound to one depot, and `depotId` arrives in the query and the body — so
 * without this, one depot head could read another depot's whole roster (names and staff
 * ids), overwrite its cells, and change other people's days off. This was the only one of
 * twenty-six controllers in this service with no depot check at all.
 */
@ApiTags('Shift roster')
@ApiBearerAuth()
@Can('driverRoster')
@Controller({ path: 'shifts', version: '1' })
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @ApiOkResponse({ type: ShiftAssignmentResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "A depot's roster cells for one week" })
  week(
    @Query() query: ListRosterQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftAssignment[]> {
    return this.roster.week(user, query.depotId, query.weekStart);
  }

  @ApiOkResponse({ type: ShiftAssignmentResponseDto })
  @Put()
  @ApiOperation({ summary: 'Set one roster cell (create or overwrite)' })
  setCell(
    @Body() dto: SetShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftAssignment> {
    return this.roster.setCell(
      user,
      dto.depotId,
      dto.weekStart,
      dto.staffId,
      dto.staffName,
      dto.day,
      dto.shift,
    );
  }

  @ApiOkResponse({ type: ShiftAssignmentResponseDto, isArray: true })
  @Put('bulk')
  @ApiOperation({ summary: 'Set many roster cells of one week at once' })
  bulk(
    @Body() dto: BulkRosterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftAssignment[]> {
    return this.roster.bulkSet(user, dto.depotId, dto.weekStart, dto.cells);
  }
}
