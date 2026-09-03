import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { HierarchyService } from '../application/services/hierarchy.service';
import { HierarchyRepository } from '../application/ports/hierarchy.repository';
import {
  InternalDescribeResponseDto,
  InternalOwnedResponseDto,
} from './dto/responses.generated.dto';

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
  @ApiOkResponse({ type: InternalOwnedResponseDto })
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

  /**
   * The supervision link itself, for services that need to know WHO somebody reports to
   * rather than which depots they cover — hr-service notifying a leave approver, for one.
   *
   * Same internal-key shape as the scope route above, and declared with it so the static
   * `internal` segment wins over `:staffId`. It exists because this table became the single
   * place a reporting line is recorded; asking hr-service's own column would read a copy
   * that no longer gets written.
   *
   * K-10 — why this is NOT folded into `internal/scope/:staffId`, which reads the same
   * table under the same guard. `scope` answers one question with one array and is asked by
   * every service on every cache miss; this one is a four-query aggregate (superior, direct
   * reports, granted depots, hierarchy depots) asked rarely, by hr-service, about one named
   * person. Adding the superior to `scope` would make the hot path pay for the cold one on
   * every request, to save a route that costs nothing to keep.
   */
  @ApiOkResponse({ type: InternalDescribeResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/describe/:staffId')
  @ApiOperation({ summary: 'Superior, direct reports and depots recorded for one account' })
  internalDescribe(@Param('staffId', ParseUUIDPipe) staffId: string) {
    return this.hierarchy.describe(staffId);
  }

  // Declared before the `:staffId` routes: `depots` is a static segment and must never be
  // read as an account id. This is the ONLY writer of a depot's assistant supervisor —
  // PATCH /depots/:id is `depotAdmin`, and a manager must not redraw their own scope.
  @ApiOkResponse({ description: 'No content.' })
  @Can('hierarchyAdmin')
  @Put('depots/:depotId/assistant')
  @HttpCode(204)
  @ApiOperation({ summary: 'Put a depot under an assistant supervisor' })
  async setDepotAssistant(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: SetAssistantDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.hierarchy.setDepotAssistant(depotId, dto.assistantSupervisorId, user.sub);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('hierarchyAdmin')
  @Delete('depots/:depotId/assistant')
  @HttpCode(204)
  @ApiOperation({ summary: 'Leave a depot without an assistant supervisor (HQ-only visibility)' })
  async clearDepotAssistant(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.hierarchy.setDepotAssistant(depotId, null, user.sub);
  }

  @Can('hierarchyAdmin')
  @Get(':staffId')
  @ApiOperation({ summary: 'Superior, direct reports and depots recorded for one account' })
  describe(
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ): ReturnType<HierarchyRepository['describe']> {
    return this.hierarchy.describe(staffId);
  }

  @ApiOkResponse({ description: 'No content.' })
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

  @ApiOkResponse({ description: 'No content.' })
  @Can('hierarchyAdmin')
  @Delete(':staffId/superior')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an account superior link' })
  async clearSuperior(@Param('staffId', ParseUUIDPipe) staffId: string): Promise<void> {
    await this.hierarchy.clearSuperior(staffId);
  }

  @ApiOkResponse({ description: 'No content.' })
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

  @ApiOkResponse({ description: 'No content.' })
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
