import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateWholesaleTierDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the tier belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Pins the tier to one product; omit for any.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ example: 'Grosir 20–49 galon' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  @ApiProperty({ example: 20, description: 'Inclusive lower bound of the quantity band.' })
  @IsInt()
  @Min(1)
  minQty!: number;

  @ApiPropertyOptional({ example: 49, description: 'Inclusive upper bound; omit for open-ended.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQty?: number;

  @ApiProperty({ example: 16000, description: 'Unit price in whole IDR.' })
  @IsInt()
  @Min(0)
  priceIdr!: number;
}

export class UpdateWholesaleTierDto {
  @ApiPropertyOptional({ example: 'Grosir 20–49 galon' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minQty?: number;

  @ApiPropertyOptional({ example: 49 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQty?: number;

  @ApiPropertyOptional({ example: 16000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceIdr?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class WholesaleTierQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list wholesale tiers for.' })
  @IsUUID()
  depotId!: string;
}
