import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, reportScopeIds } from '@hydromart/platform';

import { DispatchShiftView, ShiftService } from '../application/services/shift.service';
import { ListShiftsQueryDto } from './dto/shift.dto';
import { DispatchShiftResponseDto } from './dto/responses.generated.dto';

/** Dispatch view: who is on shift at a depot right now (design Operator 1a/1c). */
@ApiTags('Shifts')
@ApiBearerAuth()
@Can('tracking')
@Controller({ path: 'shifts', version: '1' })
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  // `trackingRead`, not the class's `tracking` — see delivery.controller.ts's list() for why.
  @ApiOkResponse({ type: DispatchShiftResponseDto, isArray: true })
  @Can('trackingRead')
  @Get()
  @ApiOperation({ summary: 'List courier shifts at a depot over a window' })
  list(
    @Query() query: ListShiftsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DispatchShiftView[]> {
    return this.shifts.search({
      // SEC-AUDIT DLV-3: without this an omitted depotId listed every depot's shifts —
      // including each courier's check-in and check-out coordinates.
      depotIds: reportScopeIds(user, query.depotId),
      depotId: query.depotId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
