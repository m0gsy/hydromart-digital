import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import {
  DashboardService,
  ExecutiveDashboard,
  FranchiseDashboard,
} from '../application/services/dashboard.service';
import { ExecutiveQueryDto } from './dto/dashboard.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN)
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('executive')
  @ApiOperation({ summary: 'Executive operational dashboard (sales + top lists + delivery SLA)' })
  executive(
    @Query() query: ExecutiveQueryDto,
    @Headers('authorization') token: string,
  ): Promise<ExecutiveDashboard> {
    return this.dashboard.executive({ from: query.from, to: query.to }, token);
  }

  // Method-level @Roles overrides the class-level roles (RolesGuard getAllAndOverride).
  @Roles(Role.FRANCHISE_OWNER)
  @Get('franchise')
  @ApiOperation({ summary: "Franchise-owner dashboard scoped to the caller's depots" })
  franchise(
    @Query() query: ExecutiveQueryDto,
    @Headers('authorization') token: string,
  ): Promise<FranchiseDashboard> {
    return this.dashboard.franchise({ from: query.from, to: query.to }, token);
  }
}
