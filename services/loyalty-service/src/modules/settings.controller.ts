import { Body, Controller, Delete, Get, HttpCode, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { assertCapability, Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { SettingsService } from '../application/services/settings.service';
import { PutSettingDto, ResetSettingDto } from './dto/settings.dto';
import { SettingDef } from '../config/setting-defs';
import { SchemaResponseDto } from './dto/responses.generated.dto';

/** Per-depot business-tunable settings: schema/effective read, GLOBAL/DEPOT put+reset. */
@ApiTags('Settings')
@ApiBearerAuth()
@Can('depotAdmin')
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @ApiOkResponse({ type: SchemaResponseDto })
  @Get('schema')
  // CA-2-19/CA-2-11: reading the tunables is not editing a depot. The class gate is
  // `depotAdmin` (MANAGER + SUPER_ADMIN), which shut head office, the director and finance
  // out of every number this returns — so /hq/scorecard was a full-page error for the two
  // roles its rail offers it to. Writes below keep `depotAdmin`.
  @Can('settingsRead')
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
    if (dto.scope === 'GLOBAL') {
      assertCapability(user, 'settingsGlobal');
    }
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
    if (dto.scope === 'GLOBAL') {
      assertCapability(user, 'settingsGlobal');
    }
    await this.settings.reset(dto.scope, dto.depotId ?? null, dto.key, user.sub);
  }
}
