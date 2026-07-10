import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DiscountType } from '../../domain/voucher';

/* ---------- Requests ---------- */

export class CreateVoucherDto {
  @ApiProperty({ example: 'HEMAT10', description: 'Unique voucher code (stored uppercase).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ example: '10% off your refill order.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @ApiProperty({ example: 10, description: 'PERCENTAGE: percent 1..100. FIXED: rupiah off.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  value!: number;

  @ApiPropertyOptional({ example: 50000, default: 0, description: 'Minimum order subtotal (IDR).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSpend?: number;

  @ApiPropertyOptional({ example: 20000, description: 'Cap for PERCENTAGE discounts (IDR).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  maxDiscount?: number;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ example: 1000, description: 'Global redemption cap.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  usageLimit?: number;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perCustomerLimit?: number = 1;
}

export class UpdateVoucherDto extends PartialType(CreateVoucherDto) {
  @ApiPropertyOptional({ description: 'Enable or disable the voucher.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class QuoteVoucherDto {
  @ApiProperty({ example: 'HEMAT10' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ example: 60000, description: 'Order product subtotal in IDR.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  subtotal!: number;
}

export class RedeemVoucherDto {
  @ApiProperty({ example: 'HEMAT10' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 60000, description: 'Order product subtotal in IDR.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  subtotal!: number;
}

export class BrowseQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
