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

import { DiscountType, VoucherStatus } from '../../domain/voucher';
import { WalletVoucher } from '../../application/services/voucher.service';

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

  @ApiProperty({ example: 10, description: 'PERCENTAGE: percent 1..100. FIXED: rupiah off. Ignored (0) for FREE_SHIPPING.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
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

  @ApiPropertyOptional({ example: 5000000, description: 'Total discount budget (IDR); null = unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  budgetCap?: number;

  @ApiPropertyOptional({ default: true, description: 'Set false to save the voucher as a draft.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
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

  @ApiPropertyOptional({ example: 8000, description: 'Order delivery fee in IDR (for FREE_SHIPPING vouchers).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingFee?: number;
}

/** Spec 5h: grant a voucher to a specific customer's wallet. */
export class GrantVoucherDto {
  @ApiProperty({ format: 'uuid', description: 'Customer to grant the voucher to.' })
  @IsUUID()
  customerId!: string;
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

  @ApiPropertyOptional({ example: 8000, description: 'Order delivery fee in IDR (for FREE_SHIPPING vouchers).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingFee?: number;
}

/* ---------- Responses ---------- */

/** One voucher in the customer's wallet (spec 4a "Voucher kamu"). */
export class MyVoucherDto {
  @ApiProperty({ example: 'HEMAT10' })
  code!: string;
  @ApiPropertyOptional({ nullable: true, example: '10% off your refill order.' })
  description!: string | null;
  @ApiProperty({ enum: DiscountType })
  discountType!: DiscountType;
  @ApiProperty({ example: 10 })
  value!: number;
  @ApiProperty({ example: 50000 })
  minSpend!: number;
  @ApiPropertyOptional({ nullable: true, example: 20000 })
  maxDiscount!: number | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  validUntil!: Date | null;
  @ApiProperty({ enum: ['AVAILABLE', 'USED', 'EXPIRED', 'UPCOMING', 'SOLD_OUT'] })
  status!: VoucherStatus;

  static from(w: WalletVoucher): MyVoucherDto {
    return {
      code: w.voucher.code,
      description: w.voucher.description,
      discountType: w.voucher.discountType,
      value: w.voucher.value,
      minSpend: w.voucher.minSpend,
      maxDiscount: w.voucher.maxDiscount,
      validUntil: w.voucher.validUntil,
      status: w.status,
    };
  }
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
