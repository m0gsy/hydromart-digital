import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { ShiftService, ShiftView } from '../application/services/shift.service';
import { ListShiftsQueryDto } from './dto/shift.dto';
import { ShiftResponseDto } from './dto/responses.generated.dto';

/** Dispatch view: who is on shift at a depot right now (design Operator 1a/1c). */
@ApiTags('Shifts')
@ApiBearerAuth()
@Can('tracking')
@Controller({ path: 'shifts', version: '1' })
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @ApiOkResponse({ type: ShiftResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List courier shifts at a depot over a window' })
  list(@Query() query: ListShiftsQueryDto): Promise<ShiftView[]> {
    return this.shifts.search({
      depotId: query.depotId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
