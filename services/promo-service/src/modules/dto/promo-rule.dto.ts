import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const KIND_VALUES = ['SPECIAL_PRICE', 'BUY_X_GET_Y', 'SHIPPING_DISCOUNT'] as const;
const CHANNEL_VALUES = ['APP', 'COUNTER'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePromoRuleDto {
  @ApiProperty({ example: 'Jumat Berkah' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: KIND_VALUES })
  @IsIn(KIND_VALUES)
  kind!: (typeof KIND_VALUES)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'null = network-wide' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  specialPrice?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  buyQty?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  getQty?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingFeeOverride?: number;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ type: [Number], example: [5], description: '0=Minggu..6=Sabtu' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @Matches(HHMM)
  startTime?: string;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @Matches(HHMM)
  endTime?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minQty?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxQty?: number;

  @ApiPropertyOptional({ enum: CHANNEL_VALUES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(CHANNEL_VALUES, { each: true })
  channels?: ('APP' | 'COUNTER')[];
}

export class UpdatePromoRuleDto extends PartialType(CreatePromoRuleDto) {
  // `name`/`kind` have no "clear to null" meaning (NOT NULL columns) — PartialType's
  // auto-added @IsOptional() skips validation for `undefined` AND explicit `null` alike,
  // so `PATCH {"name": null}` would sail past the DTO and crash Prisma with a raw 500
  // instead of a clean 400. @ValidateIf(value !== undefined) still allows omitting the
  // field (undefined = don't touch) but runs the full validator chain against `null`.
  @ApiPropertyOptional({ example: 'Jumat Berkah' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: KIND_VALUES })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(KIND_VALUES)
  kind?: (typeof KIND_VALUES)[number];

  // Same NOT NULL-at-the-DB-level reasoning as name/kind above: minQty/daysOfWeek/channels/
  // active all have DB defaults, never a "clear to null" meaning. @ValidateIf(!== undefined)
  // still allows omitting the field (undefined = don't touch) but validates an explicit
  // `null`, instead of PartialType's auto @IsOptional() letting it through to crash Prisma.
  @ApiPropertyOptional({ example: 1, default: 1 })
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minQty?: number;

  @ApiPropertyOptional({ type: [Number], example: [5], description: '0=Minggu..6=Sabtu' })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({ enum: CHANNEL_VALUES, isArray: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsEnum(CHANNEL_VALUES, { each: true })
  channels?: ('APP' | 'COUNTER')[];

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class CartLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 8000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPrice!: number;
}

export class AutoApplyQuoteDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiProperty({ enum: ['APP', 'COUNTER'] })
  @IsIn(['APP', 'COUNTER'])
  channel!: 'APP' | 'COUNTER';

  @ApiProperty({ type: [CartLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines!: CartLineDto[];
}

export class AppliedLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 8000, description: 'Original unit price before any promo.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ type: [String], description: "From the matching quote()'s LineResult." })
  @IsArray()
  @IsUUID('4', { each: true })
  appliedRuleIds!: string[];

  @ApiProperty({ example: 6000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPriceAfter!: number;

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  freeQty!: number;
}

export class AutoApplyApplyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ type: [AppliedLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppliedLineDto)
  lines!: AppliedLineDto[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  shippingAppliedRuleId?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingFeeOverride?: number;

  @ApiPropertyOptional({ example: 2000, description: 'Fee in effect before any override.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  originalShippingFee?: number;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Total galon/unit count the shipping fee applies across (same quantity used to ' +
      'compute the delivery fee). Required whenever originalShippingFee is sent (0 is a ' +
      'valid value — e.g. a shipping-only order with no galon lines); omit both fields ' +
      'together when the order has no shipping-fee concept at all.',
  })
  @ValidateIf((o) => o.originalShippingFee != null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingUnits?: number;
}
