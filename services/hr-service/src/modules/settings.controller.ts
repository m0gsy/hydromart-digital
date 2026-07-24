import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { SettingsService } from '../application/services/settings.service';
import { PutSettingDto, ResetSettingDto } from './dto/settings.dto';

/** SalaryConfiguration: attendance/payroll tunables, GLOBAL default + per-depot override. */
@ApiTags('HR Settings')
@ApiBearerAuth()
@Roles(...CAPABILITIES.hrAdmin)
@Controller({ path: 'hr/settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('schema')
  @ApiOperation({ summary: 'Setting defs + effective values for an optional depot' })
  schema(@Query('depotId') depotId?: string) {
    return this.settings.schema(depotId ?? null);
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a GLOBAL or DEPOT override' })
  async put(@Body() dto: PutSettingDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    if (dto.scope === 'GLOBAL' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can change global defaults');
    }
    await this.settings.put({
      scope: dto.scope,
      depotId: dto.depotId ?? null,
      key: dto.key,
      value: dto.value,
      updatedBy: user.sub,
    });
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an override, falling back to the parent scope' })
  async reset(@Body() dto: ResetSettingDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    if (dto.scope === 'GLOBAL' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can change global defaults');
    }
    await this.settings.reset(dto.scope, dto.depotId ?? null, dto.key);
  }
}
