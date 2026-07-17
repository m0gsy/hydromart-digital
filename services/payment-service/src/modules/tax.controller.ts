import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { TaxSettingsService } from '../application/services/tax-settings.service';
import { TaxSettingsDto, UpdateTaxSettingsDto } from './dto/tax-settings.dto';

// Tax & invoice settings (feature 19f). Finance owns billing configuration.
const TAX_ROLES = [Role.FINANCE, Role.SUPER_ADMIN] as const;

@ApiTags('Tax settings')
@ApiBearerAuth()
@Controller({ path: 'tax-settings', version: '1' })
export class TaxController {
  constructor(private readonly tax: TaxSettingsService) {}

  @Get()
  @Roles(...TAX_ROLES)
  @ApiOperation({ summary: 'Get the current tax & invoice settings' })
  async get(): Promise<TaxSettingsDto> {
    return TaxSettingsDto.from(await this.tax.get());
  }

  @Put()
  @Roles(...TAX_ROLES)
  @ApiOperation({ summary: 'Update the tax & invoice settings' })
  async update(@Body() dto: UpdateTaxSettingsDto): Promise<TaxSettingsDto> {
    return TaxSettingsDto.from(await this.tax.update(dto));
  }
}
