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
  @ApiPropertyOptional()
  @IsOptional()
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
  @Type(() => CartLineDto)
  lines!: CartLineDto[];
}

export class AutoApplyApplyDto extends AutoApplyQuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;
}
