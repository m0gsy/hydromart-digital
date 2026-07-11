import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ForecastItem, ForecastResult, ForecastService } from '../application/services/forecast.service';
import { RebuildService } from '../application/services/rebuild.service';
import { DemandQueryDto, DepotRollupQueryDto, RebuildQueryDto } from './dto/forecast.dto';

// Planning staff only — never customer-facing. Class-level roles cover the query endpoints;
// rebuild overrides with SUPER_ADMIN below (RolesGuard uses getAllAndOverride: handler wins).
const PLANNING_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.HEAD_OFFICE,
  Role.SUPER_ADMIN,
  Role.FRANCHISE_OWNER,
];

@ApiTags('forecast')
@ApiBearerAuth()
@Roles(...PLANNING_ROLES)
@Controller({ path: 'forecast', version: '1' })
export class ForecastController {
  constructor(
    private readonly forecasts: ForecastService,
    private readonly rebuild: RebuildService,
  ) {}

  // `demand` (static) is declared before `depot/:depotId` (param); distinct prefixes make
  // the order safe regardless, but static-first is kept as the convention.

  @Get('demand')
  @ApiOperation({ summary: 'Single-product demand forecast (omit depotId for a global forecast)' })
  async demand(@Query() query: DemandQueryDto): Promise<ForecastResult> {
    return this.forecasts.demand({
      productId: query.productId,
      depotId: query.depotId, // omitted -> undefined -> global (all depots)
      historyDays: query.historyDays,
      horizonDays: query.horizonDays,
    });
  }

  @Get('depot/:depotId')
  @ApiOperation({ summary: 'Per-depot planning rollup: every product with demand, forecast, ranked by predicted total' })
  async depotRollup(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: DepotRollupQueryDto,
  ): Promise<ForecastItem[]> {
    return this.forecasts.depotRollup({
      depotId,
      historyDays: query.historyDays,
      horizonDays: query.horizonDays,
      limit: query.limit,
    });
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rebuild the read model from order-service completed orders (backfill)' })
  async rebuildNow(@Query() query: RebuildQueryDto): Promise<{ ingested: number; pages: number }> {
    return this.rebuild.rebuild(query.limit);
  }
}
