import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, depotScopeIds } from '@hydromart/platform';

import {
  DashboardService,
  ExecutiveDashboard,
  FranchiseDashboard,
  NetworkDashboard,
  MonthlyOperationalPnl,
} from '../application/services/dashboard.service';
import { ExecutiveQueryDto, MonthlyPnlQueryDto } from './dto/dashboard.dto';
import { ExecutiveDashboardResponseDto, FranchiseDashboardResponseDto, MonthlyOperationalPnlResponseDto, NetworkDashboardResponseDto } from './dto/responses.generated.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Can('dashboard')
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /*
   * `dashboard` admits MANAGER, SUPERVISOR and ASSISTANT_SUPERVISOR — three depot-scoped
   * roles — and this endpoint carries no depotId, so DepotScopeGuard had nothing to compare
   * and served all three the whole network's revenue. The mobile manager home printed that
   * number under the name of a single depot.
   *
   * `depotScopeIds` gives the same answer the rest of the platform gives: the caller's own
   * depots, `undefined` for head office (the network, unchanged), a refusal for a scoped
   * account with no depots. An explicit `depotId` narrows within that set — a manager over
   * several depots asking about the one their screen names — and is refused outside it.
   */
  @ApiOkResponse({ type: ExecutiveDashboardResponseDto })
  @Get('executive')
  @ApiOperation({ summary: 'Executive operational dashboard (sales + top lists + delivery SLA)' })
  executive(
    @Query() query: ExecutiveQueryDto,
    @Headers('authorization') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExecutiveDashboard> {
    return this.dashboard.executive(
      { from: query.from, to: query.to },
      token,
      depotScopeIds(user, query.depotId),
    );
  }

  @ApiOkResponse({ type: MonthlyOperationalPnlResponseDto })
  @Get('monthly-pnl')
  @ApiOperation({
    summary: 'Depot operational monthly P&L with explicit revenue/cost source availability',
  })
  monthlyPnl(
    @Query() query: MonthlyPnlQueryDto,
    @Headers('authorization') token: string,
  ): Promise<MonthlyOperationalPnl> {
    return this.dashboard.monthlyPnl(query.depotId, query.month, token);
  }

  @ApiOkResponse({ type: NetworkDashboardResponseDto })
  @Get('network')
  @ApiOperation({ summary: 'Network per-depot roll-up (revenue, orders, SLA, low stock per depot)' })
  network(
    @Query() query: ExecutiveQueryDto,
    @Headers('authorization') token: string,
  ): Promise<NetworkDashboard> {
    return this.dashboard.network({ from: query.from, to: query.to }, token);
  }

  // Method-level @Roles overrides the class-level roles (RolesGuard getAllAndOverride).
  @ApiOkResponse({ type: FranchiseDashboardResponseDto })
  @Can('franchise')
  @Get('franchise')
  @ApiOperation({ summary: "Franchise-owner dashboard scoped to the caller's depots" })
  franchise(
    @Query() query: ExecutiveQueryDto,
    @Headers('authorization') token: string,
  ): Promise<FranchiseDashboard> {
    return this.dashboard.franchise({ from: query.from, to: query.to }, token);
  }
}
