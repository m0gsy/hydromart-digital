import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { HierarchyService } from '../application/services/hierarchy.service';

export class SetAssistantDto {
  @IsUUID()
  assistantSupervisorId!: string;
}

export class SetSuperiorDto {
  @IsUUID()
  superiorId!: string;
}

/**
 * The supervision hierarchy: Depot -> Assistant Supervisor -> Supervisor -> Manager.
 *
 * This map is what every multi-depot scope resolves from, which is why writing it is
 * `hierarchyAdmin` (SUPER_ADMIN by default) and nothing weaker.
 */
@ApiTags('Hierarchy')
@ApiBearerAuth()
@Controller({ path: 'staff-hierarchy', version: '1' })
export class HierarchyController {
  constructor(private readonly hierarchy: HierarchyService) {}

  // What every other service calls to scope a supervisor. Internal key auth, not a user
  // token: it is asked on behalf of the caller, by a machine, on every cache miss.
  // Declared FIRST so the static `internal` segment wins over `:staffId`.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/scope/:staffId')
  @ApiOperation({ summary: 'Depots an account is responsible for (hierarchy UNION direct grants)' })
  async internalScope(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Query('role') role: string,
  ): Promise<{ depotIds: string[] }> {
    return { depotIds: await this.hierarchy.scopedDepotIds(staffId, role ?? '') };
  }

  @Can('hierarchyAdmin')
  @Get(':staffId')
  @ApiOperation({ summary: 'Superior, direct reports and depots recorded for one account' })
  describe(@Param('staffId', ParseUUIDPipe) staffId: string) {
    return this.hierarchy.describe(staffId);
  }

  @Can('hierarchyAdmin')
  @Put(':staffId/superior')
  @HttpCode(204)
  @ApiOperation({ summary: 'Point an account at its superior (replaces any existing link)' })
  async setSuperior(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: SetSuperiorDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.hierarchy.setSuperior(staffId, dto.superiorId, user.sub);
  }

  @Can('hierarchyAdmin')
  @Delete(':staffId/superior')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an account superior link' })
  async clearSuperior(@Param('staffId', ParseUUIDPipe) staffId: string): Promise<void> {
    await this.hierarchy.clearSuperior(staffId);
  }

  @Can('hierarchyAdmin')
  @Put(':staffId/depots/:depotId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Grant one depot directly, on top of the hierarchy walk' })
  async grant(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.hierarchy.grantDepot(staffId, depotId, user.sub);
  }

  @Can('hierarchyAdmin')
  @Delete(':staffId/depots/:depotId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a direct depot grant' })
  async revoke(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Param('depotId', ParseUUIDPipe) depotId: string,
  ): Promise<void> {
    await this.hierarchy.revokeDepot(staffId, depotId);
  }

}
