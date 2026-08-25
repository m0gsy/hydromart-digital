import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ImportCustomerRowDto {
  @ApiProperty({ example: 'Siti Aminah' })
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: '081234567890' })
  @IsString()
  @MaxLength(32)
  phone!: string;

  @ApiPropertyOptional({ example: 'Jl. Melati 3 No. 7 RT 04' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine?: string;

  @ApiPropertyOptional({ example: 'Bekasi' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ example: 'Jawa Barat' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  province?: string;

  @ApiPropertyOptional({
    example: 'pagar hijau sebelah warung Bu Ani',
    description: 'Patokan — reaches the courier through the order note.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string;
}

export class ImportResellerRowDto {
  @ApiProperty({ example: 'Toko Berkah' })
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: '081234567890' })
  @IsString()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  discountPct!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  monthlyTargetQty!: number;

  /**
   * J11: the SOP flat price per gallon. Same bounds as the single-agen form, so a sheet
   * cannot set a price the form would refuse.
   */
  @ApiPropertyOptional({ minimum: 0, maximum: 10_000_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  flatGallonPriceIdr?: number;

  @ApiProperty({ example: '2026-01-01' })
  @IsISO8601()
  joinDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ImportCustomersDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the imported customers belong to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ type: [ImportCustomerRowDto], description: 'Max 500 rows per file.' })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerRowDto)
  rows!: ImportCustomerRowDto[];
}

export class ImportResellersDto {
  @ApiProperty({ format: 'uuid', description: 'Home depot for the imported resellers.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ type: [ImportResellerRowDto], description: 'Max 500 rows per file.' })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportResellerRowDto)
  rows!: ImportResellerRowDto[];
}
