import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { Role, Roles } from '@hydromart/platform';

import {
  ChurnItem,
  ForecastItem,
  ForecastResult,
  ForecastService,
  SalesForecast,
} from '../application/services/forecast.service';
import { RebuildService } from '../application/services/rebuild.service';
import {
  ChurnQueryDto,
  DemandQueryDto,
  DepotRollupQueryDto,
  RebuildQueryDto,
  SalesQueryDto,
} from './dto/forecast.dto';

// Planning staff only — never customer-facing. Class-level roles cover the query endpoints;
// rebuild overrides with SUPER_ADMIN below (RolesGuard uses getAllAndOverride: handler wins).
@ApiTags('forecast')
@ApiBearerAuth()
@Roles(...CAPABILITIES.forecast)
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

  @Get('sales')
  @ApiOperation({ summary: 'Daily revenue forecast (omit depotId for a global forecast)' })
  async sales(@Query() query: SalesQueryDto): Promise<SalesForecast> {
    return this.forecasts.salesForecast({
      depotId: query.depotId, // omitted -> undefined -> global (all depots)
      historyDays: query.historyDays,
      horizonDays: query.horizonDays,
    });
  }

  // Churn is CRM-facing (re-engagement) — overrides the class PLANNING_ROLES with CHURN_ROLES
  // via getAllAndOverride (handler wins). A planning role not in this set (e.g. DEPOT_OPERATOR)
  // is rejected.
  @Roles(...CAPABILITIES.churn)
  @Get('churn')
  @ApiOperation({ summary: 'At-risk customers ranked by recency-driven churn risk' })
  async churn(@Query() query: ChurnQueryDto): Promise<{ customers: ChurnItem[] }> {
    return this.forecasts.churnList({
      depotId: query.depotId,
      limit: query.limit,
      windowDays: query.days,
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
