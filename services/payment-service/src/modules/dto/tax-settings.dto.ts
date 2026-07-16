import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

import { TaxSettingsRecord } from '../../application/ports/tax-settings.repository';

export class UpdateTaxSettingsDto {
  @ApiProperty({ example: 11, description: 'PPN / VAT percentage (0–100).' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ppnPercent!: number;

  @ApiProperty({ description: 'When true, PPN is derived from the price rather than added on top.' })
  @IsBoolean()
  priceIncludesTax!: boolean;

  @ApiProperty({ example: 'HM/{YYYY}/{MM}/{SEQ}', description: 'Invoice-number format template.' })
  @IsString()
  @MaxLength(64)
  invoiceFormat!: string;

  @ApiProperty({ example: 'PT Hydromart Nusantara' })
  @IsString()
  @MaxLength(160)
  companyName!: string;

  @ApiProperty({ example: '01.234.567.8-901.000', description: 'Company tax id (may be blank).' })
  @IsString()
  @MaxLength(64)
  npwp!: string;

  @ApiProperty({ example: 'Jl. Sudirman Kav. 21, Jakarta', description: 'Company address (may be blank).' })
  @IsString()
  @MaxLength(255)
  address!: string;
}

export class TaxSettingsDto {
  @ApiProperty() ppnPercent!: number;
  @ApiProperty() priceIncludesTax!: boolean;
  @ApiProperty() invoiceFormat!: string;
  @ApiProperty() companyName!: string;
  @ApiProperty() npwp!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ nullable: true }) updatedAt!: string | null;

  static from(record: TaxSettingsRecord): TaxSettingsDto {
    return {
      ppnPercent: record.ppnPercent,
      priceIncludesTax: record.priceIncludesTax,
      invoiceFormat: record.invoiceFormat,
      companyName: record.companyName,
      npwp: record.npwp,
      address: record.address,
      updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
    };
  }
}
