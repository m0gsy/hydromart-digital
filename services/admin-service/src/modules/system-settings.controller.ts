import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can } from '@hydromart/platform';

import { SystemSettingsService } from '../application/services/system-settings.service';
import { SaveSystemSettingsDto, SystemSettingsDto } from './dto/system-settings.dto';

// Design 8b — platform config (singleton). Super-admin only, read and write.
@ApiTags('System settings')
@ApiBearerAuth()
@Can('platformAdmin')
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'system-settings', version: '1' })
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @ApiOkResponse({ type: SystemSettingsDto })
  @Get()
  @ApiOperation({ summary: 'Read platform settings (timezone, currency, service radius)' })
  async get(): Promise<SystemSettingsDto> {
    return SystemSettingsDto.from(await this.settings.get());
  }

  @ApiOkResponse({ type: SystemSettingsDto })
  @Put()
  @ApiOperation({ summary: 'Replace platform settings' })
  async save(@Body() dto: SaveSystemSettingsDto): Promise<SystemSettingsDto> {
    return SystemSettingsDto.from(await this.settings.save(dto));
  }
}
