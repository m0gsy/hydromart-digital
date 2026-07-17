import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

import { DiscountType } from '../../domain/voucher';
import { VoucherRequestStatus } from '../../domain/voucher-request';

export class ProposeVoucherRequestDto {
  @ApiProperty({ description: 'Depot name captured for the HQ queue display.' })
  @IsString()
  @MaxLength(200)
  depotName!: string;

  @ApiProperty({ example: 'DEPOT10', description: 'Proposed voucher code.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ example: '10% off refill at our depot.' })
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

  @ApiPropertyOptional({ example: 50000, default: 0 })
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

  @ApiPropertyOptional({ example: 'Untuk menaikkan repeat order area kami.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class ListVoucherRequestsQueryDto {
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

  @ApiPropertyOptional({ enum: VoucherRequestStatus, description: 'Filter by decision status.' })
  @IsOptional()
  @IsEnum(VoucherRequestStatus)
  status?: VoucherRequestStatus;
}
