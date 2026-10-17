import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public, TaxRounding } from '@hydromart/platform';

import { TaxSettingsService } from '../application/services/tax-settings.service';
import { TaxSettingsDto, UpdateTaxSettingsDto } from './dto/tax-settings.dto';

// Tax & invoice settings (feature 19f). Finance owns billing configuration.

/** What order-service needs to record the PPN inside an order's total — nothing else. */
export class TaxRateDto {
  @ApiProperty() ppnPercent!: number;
  @ApiProperty({ enum: TaxRounding }) taxRounding!: TaxRounding;
}

@ApiTags('Tax settings')
@ApiBearerAuth()
@Controller({ path: 'tax-settings', version: '1' })
export class TaxController {
  constructor(private readonly tax: TaxSettingsService) {}

  // Internal-key only: the rate, not the company identity (NPWP, address) the settings screen
  // carries. Declared before nothing path-shaped, so it cannot be shadowed.
  @ApiOkResponse({ type: TaxRateDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/rate')
  @ApiOperation({ summary: 'PPN rate and rounding method (internal service auth)' })
  async rate(): Promise<TaxRateDto> {
    const settings = TaxSettingsDto.from(await this.tax.get());
    return { ppnPercent: settings.ppnPercent, taxRounding: settings.taxRounding };
  }

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
    return TaxSettingsDto.from(await this.tax.update(dto, dto.seenUpdatedAt));
  }
}
