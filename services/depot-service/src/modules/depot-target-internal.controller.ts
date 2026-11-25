import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { DepotTargetRow, DepotTargetService } from '../application/services/depot-target.service';
import { DepotTargetsByMonthQueryDto, DepotTargetsByMonthResponseDto } from './dto/depot-target.dto';

/** Service-to-service (HD-16): the AI read API's "target vs actual" reads every depot's month target in one call. */
@ApiTags('Depot Targets')
@Controller({ path: 'depot-targets', version: '1' })
export class DepotTargetInternalController {
  constructor(private readonly targets: DepotTargetService) {}

  @ApiOkResponse({ type: DepotTargetsByMonthResponseDto, isArray: true })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/by-month')
  @ApiOperation({ summary: 'Internal: the month target of each depot named (1 to 100 ids), 0 where none is set' })
  byMonth(@Query() query: DepotTargetsByMonthQueryDto): Promise<DepotTargetRow[]> {
    return this.targets.forMonth(query.depotIds, query.month);
  }
}
