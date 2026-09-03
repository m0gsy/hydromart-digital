import { Body, Controller, Delete, Get, HttpCode, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { assertCapability, Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { SettingsService } from '../application/services/settings.service';
import { PutSettingDto, ResetSettingDto } from './dto/settings.dto';
import { SettingDef } from '../config/setting-defs';
import { SettingsSchemaResponseDto } from './dto/responses.generated.dto';

/** Per-depot business-tunable settings: schema/effective read, GLOBAL/DEPOT put+reset. */
@ApiTags('Settings')
@ApiBearerAuth()
@Can('forecast')
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

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
