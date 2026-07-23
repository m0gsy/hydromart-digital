import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { PromotionAnalytics } from '../../application/services/promotion.service';

export class CreatePromotionDto {
  @ApiProperty({ example: 'Gratis ongkir pertama' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 'Pesanan galon pertamamu, ongkir kami tanggung.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'https://cdn.hydromart.id/promo/free-ongkir.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'Pesan sekarang' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ctaLabel?: string;

  @ApiPropertyOptional({ example: '/catalog' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ctaHref?: string;

  @ApiPropertyOptional({ example: 'HEMAT10', description: 'Voucher code this banner promotes.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  voucherCode?: string;

  @ApiPropertyOptional({ example: 0, default: 0, description: 'Lower sorts first.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {
  @ApiPropertyOptional({ description: 'Show or hide the promotion.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PromotionDailyUseDto {
  @ApiProperty({ example: '2026-07-22' })
  day!: string;

  @ApiProperty({ example: 3 })
  uses!: number;
}

export class PromotionTopCustomerDto {
  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  uses!: number;

  @ApiProperty({ description: 'Total discount applied in integer IDR.' })
  savingsIdr!: number;
}

export class PromotionAnalyticsDto implements PromotionAnalytics {
  @ApiProperty({ format: 'uuid' })
  promotionId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  voucherCode!: string | null;

  @ApiProperty()
  totalUses!: number;

  @ApiProperty()
  usesLast7Days!: number;

  @ApiProperty({ description: 'Total discount applied in integer IDR.' })
  totalSavingsIdr!: number;

  @ApiProperty({ type: [String], format: 'uuid' })
  affectedOrderIds!: string[];

  @ApiProperty()
  affectedOrderCount!: number;

  @ApiProperty({ nullable: true, description: 'Gross affected-order value in integer IDR.' })
  grossAffectedOrderValueIdr!: number | null;

  @ApiProperty({ type: [PromotionDailyUseDto] })
  dailyUses!: PromotionDailyUseDto[];

  @ApiProperty({ type: [PromotionTopCustomerDto] })
  topCustomers!: PromotionTopCustomerDto[];

  @ApiProperty({ enum: ['ok', 'unavailable', 'not_applicable'] })
  orderValueSource!: 'ok' | 'unavailable' | 'not_applicable';

  static from(value: PromotionAnalytics): PromotionAnalyticsDto {
    return Object.assign(new PromotionAnalyticsDto(), value);
  }
}
