import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalAuthGuard, Public } from '@hydromart/platform';

import { DepotFixedCostService } from '../application/services/depot-fixed-cost.service';
import { DepotFixedCostTotalResponseDto, DepotFixedCostTotalsQueryDto } from './dto/depot-fixed-cost.dto';

/** Service-to-service (HD-16 PR-A2): the depot P&L joins the fixed costs HQ imported. */
@ApiTags('Depot fixed costs')
@Controller({ path: 'depot-fixed-costs', version: '1' })
export class DepotFixedCostInternalController {
  constructor(private readonly costs: DepotFixedCostService) {}

  @ApiOkResponse({ type: DepotFixedCostTotalResponseDto, isArray: true })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/totals')
  @ApiOperation({ summary: 'Internal: total fixed cost of each depot named (1 to 100 ids) for a month; depots with none are absent' })
  totals(@Query() query: DepotFixedCostTotalsQueryDto): Promise<DepotFixedCostTotalResponseDto[]> {
    return this.costs.totalsForDepots(query.month, query.depotIds);
  }
}
