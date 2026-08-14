import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { TaxSettingsService } from '../application/services/tax-settings.service';
import { TaxSettingsDto, UpdateTaxSettingsDto } from './dto/tax-settings.dto';

// Tax & invoice settings (feature 19f). Finance owns billing configuration.

@ApiTags('Tax settings')
@ApiBearerAuth()
@Controller({ path: 'tax-settings', version: '1' })
export class TaxController {
  constructor(private readonly tax: TaxSettingsService) {}

  @ApiOkResponse({ type: TaxSettingsDto })
  @Get()
  @Can('taxSettings')
  @ApiOperation({ summary: 'Get the current tax & invoice settings' })
  async get(): Promise<TaxSettingsDto> {
    return TaxSettingsDto.from(await this.tax.get());
  }

  @ApiOkResponse({ type: TaxSettingsDto })
  @Put()
  @Can('taxSettings')
  @ApiOperation({ summary: 'Update the tax & invoice settings' })
  async update(@Body() dto: UpdateTaxSettingsDto): Promise<TaxSettingsDto> {
    return TaxSettingsDto.from(await this.tax.update(dto));
  }
}
