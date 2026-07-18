import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { CurrentUser, AuthenticatedUser, Role, Roles } from '@hydromart/platform';

import {
  ChurnItem,
  ForecastItem,
  ForecastResult,
  ForecastService,
  SalesForecast,
} from '../application/services/forecast.service';
import { DepotOwnershipPort } from '../application/ports/depot-ownership.port';
import { FORECAST_TOKENS } from '../application/tokens';
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
    @Inject(FORECAST_TOKENS.DepotOwnership) private readonly ownership: DepotOwnershipPort,
  ) {}

  // A franchise owner may only forecast a depot they own — and must name one (no network-wide
  // global forecast). Depot staff are already pinned by DepotScopeGuard; HQ/finance/super-admin
  // are unrestricted. No-op for everyone but FRANCHISE_OWNER.
  private async assertForecastDepot(
    user: AuthenticatedUser,
    depotId: string | undefined,
  ): Promise<void> {
    if (user.role !== Role.FRANCHISE_OWNER) return;
    if (!depotId) {
      throw new ForbiddenException('Akun waralaba harus memilih depot miliknya.');
    }
    const owned = await this.ownership.ownedDepotIds(user.sub);
    if (!owned.includes(depotId)) {
      throw new ForbiddenException('Akun waralaba ini hanya boleh mengakses depot miliknya.');
    }
  }

  // `demand` (static) is declared before `depot/:depotId` (param); distinct prefixes make
  // the order safe regardless, but static-first is kept as the convention.

  @Get('demand')
  @ApiOperation({ summary: 'Single-product demand forecast (omit depotId for a global forecast)' })
  async demand(
    @Query() query: DemandQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ForecastResult> {
    await this.assertForecastDepot(user, query.depotId);
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
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ForecastItem[]> {
    await this.assertForecastDepot(user, depotId);
    return this.forecasts.depotRollup({
      depotId,
      historyDays: query.historyDays,
      horizonDays: query.horizonDays,
      limit: query.limit,
    });
  }

  @Get('sales')
  @ApiOperation({ summary: 'Daily revenue forecast (omit depotId for a global forecast)' })
  async sales(
    @Query() query: SalesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SalesForecast> {
    await this.assertForecastDepot(user, query.depotId);
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
