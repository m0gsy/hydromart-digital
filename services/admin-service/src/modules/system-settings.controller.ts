import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { SystemSettingsService } from '../application/services/system-settings.service';
import { SaveSystemSettingsDto, SystemSettingsDto } from './dto/system-settings.dto';

// Design 8b — platform config (singleton). Super-admin only, read and write.
@ApiTags('System settings')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'system-settings', version: '1' })
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Read platform settings (timezone, currency, service radius)' })
  async get(): Promise<SystemSettingsDto> {
    return SystemSettingsDto.from(await this.settings.get());
  }

  @Put()
  @ApiOperation({ summary: 'Replace platform settings' })
  async save(@Body() dto: SaveSystemSettingsDto): Promise<SystemSettingsDto> {
    return SystemSettingsDto.from(await this.settings.save(dto));
  }
}
