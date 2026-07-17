import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { PricingAdjustType } from '../../domain/pricing-rule';
import { PriceOverrideStatus } from '../../domain/price-override-proposal';

export class ProposePriceOverrideDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Product name captured for the HQ queue display.' })
  @IsString()
  @MaxLength(200)
  productName!: string;

  @ApiProperty({ example: 20000, description: "Depot's current price for the product (IDR)." })
  @Type(() => Number)
  @IsPositive()
  currentPrice!: number;

  @ApiProperty({ enum: PricingAdjustType })
  @IsEnum(PricingAdjustType)
  adjustType!: PricingAdjustType;

  @ApiProperty({ example: -10, description: 'PERCENT = signed percent; FIXED = signed rupiah delta.' })
  @Type(() => Number)
  @IsNumber()
  value!: number;

  @ApiPropertyOptional({ example: 'Menyesuaikan harga pesaing sekitar.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class ListPriceOverridesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ enum: PriceOverrideStatus, description: 'Filter by decision status.' })
  @IsOptional()
  @IsEnum(PriceOverrideStatus)
  status?: PriceOverrideStatus;
}
