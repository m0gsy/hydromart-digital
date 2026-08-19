import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BrowseProductsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Search by product name or SKU.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateProductDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 'Air Galon 19L' })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ example: 'AIR-GALON-19L' })
  @IsString()
  @MaxLength(60)
  sku!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 'Galon 19L' })
  @IsString()
  @MaxLength(50)
  unit!: string;

  @ApiPropertyOptional({
    example: 19000,
    description: 'Fill volume in millilitres. Omit for lines that hold nothing (caps, seals).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100_000)
  volumeMl?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Refillable galon line. Drives the per-galon delivery fee, so a 600ml bottle stays false even though it has a volume.',
  })
  @IsOptional()
  @IsBoolean()
  isGallon?: boolean;

  /*
   * A8: whole rupiah, enforced here rather than mopped up downstream.
   *
   * The column is `Decimal(12,2)` and this DTO only asked for positive, so `19999.5` was
   * accepted and stored — measured, 201 with `basePrice: 19999.5` in the response. Nothing
   * in the business can pay half a rupiah: no coin circulates, no receipt prints one, no
   * cashier hands one back. It used to leave the cart with a fractional subtotal, which the
   * voucher quote rejects (`@IsInt()` on `QuoteVoucherDto.subtotal`) as a 400 the screen
   * renders as "voucher tidak valid" — a price defect wearing a promo error's clothes.
   *
   * A1 since made the cart round every line through `money()`, so that chain is closed
   * downstream too. This is the source: a price nobody can pay should not be storable, and
   * silently rounding one on read is not the same as refusing to accept it.
   */
  @ApiProperty({ example: 20000, description: 'Base price in IDR, whole rupiah.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  basePrice!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Additional gallery image URLs beyond imageUrl (the primary).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  images?: string[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
