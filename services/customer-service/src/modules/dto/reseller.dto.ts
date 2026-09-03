import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class RegisterResellerDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty() @IsUUID() homeDepotId!: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) monthlyTargetQty!: number;
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    description: 'Flat reseller discount percent off subtotal.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPct?: number;
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Flat rupiah per galon (SOP: 5000). > 0 overrides discountPct at checkout.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  flatGallonPriceIdr?: number;
  @ApiProperty({ example: '2026-01-01' }) @IsISO8601() joinDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateResellerDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() homeDepotId?: string;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) monthlyTargetQty?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPct?: number;
  @ApiPropertyOptional({ minimum: 0, description: 'Flat rupiah per galon; 0 = price by percent.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  flatGallonPriceIdr?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  /**
   * K4.2. When the price/status change should take effect. A moment in the future
   * SCHEDULES it — the profile is left alone and a sweep applies it on the day. Omitted
   * or in the past means now, which is the behaviour every caller had before.
   *
   * Only the priced fields (discountPct, flatGallonPriceIdr, active) can be scheduled; a
   * date with none of them changing is rejected rather than silently doing nothing.
   */
  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}

export class ListResellerQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() depotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
