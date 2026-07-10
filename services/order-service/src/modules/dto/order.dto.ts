import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { OrderStatus } from '../../domain/order-status';

/** Delivery address snapshot supplied at checkout (frozen onto the order). */
export class DeliveryAddressDto {
  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: '081234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'Jl. Merdeka No. 10, RT 01/RW 02' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine!: string;

  @ApiProperty({ example: 'Bandung' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'Jawa Barat' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  province!: string;

  @ApiPropertyOptional({ example: '40111' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  @ApiPropertyOptional({ example: -6.9147 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 107.6098 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Titip ke satpam bila tidak ada orang.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class CheckoutDto {
  @ApiProperty({ type: DeliveryAddressDto })
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;

  @ApiPropertyOptional({ example: 'HEMAT10', description: 'Optional discount voucher code.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  voucherCode?: string;
}

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class CancelOrderDto {
  @ApiPropertyOptional({
    example: 'Berubah pikiran.',
    description: 'Optional cancellation reason.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus, description: 'Target status (must be a legal next state).' })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ example: 'Driver Andi assigned.', description: 'Optional note.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
