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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import {
  Can,
  CurrentUser,
  AuthenticatedUser,
  depotScopeIds,
  InternalAuthGuard,
  Public,
  Role,
  Roles,
} from '@hydromart/platform';

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
import { Churn3ResponseDto, ForecastItemResponseDto, ForecastResponseDto, RebuildNow3ResponseDto, SalesForecastResponseDto } from './dto/responses.generated.dto';

// Planning staff only — never customer-facing. Class-level roles cover the query endpoints;
// rebuild overrides with SUPER_ADMIN below (RolesGuard uses getAllAndOverride: handler wins).
@ApiTags('forecast')
@ApiBearerAuth()
@Can('forecast')
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

  @ApiOkResponse({ type: ForecastResponseDto })
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

  @ApiOkResponse({ type: ForecastItemResponseDto, isArray: true })
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

  @ApiOkResponse({ type: SalesForecastResponseDto })
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
  // via getAllAndOverride (handler wins). A planning role not in this set (e.g. KEPALA_DEPOT)
  // is rejected.
  @ApiOkResponse({ type: Churn3ResponseDto })
  @Can('churn')
  @Get('churn')
  @ApiOperation({ summary: 'At-risk customers ranked by recency-driven churn risk' })
  async churn(
    @Query() query: ChurnQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ customers: ChurnItem[] }> {
    /*
     * `churn` admits MANAGER, a depot-SCOPED role, and `depotId` here is OPTIONAL — so the
     * screen's "Semua depot" setting sent no depot at all and this handler answered with
     * every at-risk customer in the network, names and order history included. The guard
     * could not catch it: with no depotId in the request there was nothing to compare.
     *
     * `depotScopeIds` is the same answer every other list read gives — the caller's own
     * depots, `undefined` for marketing/head office (the network, unchanged), a refusal for
     * a scoped account with no depots. Asking for a depot outside the set is refused.
     */
    const scope = depotScopeIds(user, query.depotId);
    return this.forecasts.churnList({
      depotId: query.depotId,
      depotIds: scope,
      limit: query.limit,
      windowDays: query.days,
    });
  }

  /**
   * One customer's churn band, for the depot CRM card that used to hardcode null (S2).
   *
   * Internal key rather than `churn`: the caller is customer-service assembling a screen and
   * holds no token for the staff member looking at it. `@Public()` short-circuits RolesGuard.
   *
   * Not a lookup in the list above: that list is the top-N most at-risk, so anyone outside
   * it would come back LOW when the truth is "not in the sample".
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/churn-band')
  @ApiOperation({ summary: "One customer's churn band (internal service auth)" })
  @ApiOkResponse({ description: 'Risk band for one customer, or nulls when they never ordered.' })
  async churnBand(
    @Query('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<{ riskBand: string | null; riskScore: number | null; daysSince: number | null }> {
    const risk = await this.forecasts.churnFor(customerId);
    // A 200 with nulls, not a 404: "this customer has never ordered" is an answer, and the
    // caller is composing a card that must render either way.
    return risk ?? { riskBand: null, riskScore: null, daysSince: null };
  }

  @ApiOkResponse({ type: RebuildNow3ResponseDto })
  @Roles(Role.SUPER_ADMIN)
  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rebuild the read model from order-service completed orders (backfill)' })
  async rebuildNow(@Query() query: RebuildQueryDto): Promise<{ ingested: number; pages: number }> {
    return this.rebuild.rebuild(query.limit);
  }
}
