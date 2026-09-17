import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { assertCapability, Can, AuthenticatedUser, CurrentUser, Role } from '@hydromart/platform';

import { SettingsService } from '../application/services/settings.service';
import { DepotOwnershipPort } from '../application/ports/depot-ownership.port';
import { FORECAST_TOKENS } from '../application/tokens';
import { PutSettingDto, ResetSettingDto } from './dto/settings.dto';
import { SettingDef } from '../config/setting-defs';
import { SettingsSchemaResponseDto } from './dto/responses.generated.dto';

/** Per-depot business-tunable settings: schema/effective read, GLOBAL/DEPOT put+reset. */
@ApiTags('Settings')
@ApiBearerAuth()
@Can('forecast')
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    @Inject(FORECAST_TOKENS.DepotOwnership) private readonly ownership: DepotOwnershipPort,
  ) {}

  /**
   * Who may change which depot's forecast model (owner decision 2026-09-17).
   *
   * The class gate is `forecast`, which also admits depot staff and franchise owners — and a
   * franchise owner is not held to a depot by DepotScopeGuard, so any owner could re-point
   * any depot's model. Head office keeps its writes (/hq/forecast-models); a franchise owner
   * may write only a depot they own; depot staff read. GLOBAL still needs `settingsGlobal`.
   */
  private async assertMayWrite(
    user: AuthenticatedUser,
    scope: 'GLOBAL' | 'DEPOT',
    depotId: string | null,
  ): Promise<void> {
    if (scope === 'GLOBAL') {
      assertCapability(user, 'settingsGlobal');
      return;
    }
    const role = user.role as Role;
    if (role === Role.HEAD_OFFICE || role === Role.DIREKTUR || role === Role.SUPER_ADMIN) return;
    if (role === Role.FRANCHISE_OWNER && depotId) {
      const owned = await this.ownership.ownedDepotIds(user.sub);
      if (owned.includes(depotId)) return;
    }
    throw new ForbiddenException(
      'Hanya kantor pusat atau pemilik depot yang boleh mengubah model forecast.',
    );
  }

  @ApiOkResponse({ type: SettingsSchemaResponseDto })
  @Get('schema')
  @ApiOperation({ summary: 'Setting defs + effective values for an optional depot' })
  schema(
    @Query('depotId') depotId?: string,
  ): Promise<{ defs: SettingDef[]; effective: Record<string, number | string> }> {
    return this.settings.schema(depotId ?? null);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a GLOBAL or DEPOT override' })
  async put(@Body() dto: PutSettingDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.assertMayWrite(user, dto.scope, dto.depotId ?? null);
    await this.settings.put({
      scope: dto.scope,
      depotId: dto.depotId ?? null,
      key: dto.key,
      value: dto.value,
      updatedBy: user.sub,
    });
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an override, falling back to the parent scope' })
  async reset(@Body() dto: ResetSettingDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.assertMayWrite(user, dto.scope, dto.depotId ?? null);
    await this.settings.reset(dto.scope, dto.depotId ?? null, dto.key, user.sub);
  }
}
