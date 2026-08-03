import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Depot the customer picked. Required when the address carries no map pin, ignored when it does.',
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ example: 'HEMAT10', description: 'Optional discount voucher code.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  voucherCode?: string;

  @ApiPropertyOptional({
    example: '2026-07-20 09:00-12:00',
    description:
      'Optional customer-preferred delivery time-window (free-form label, not slot-checked).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  deliveryWindow?: string;
}

export class ListOrdersQueryDto {
  // Bound the OFFSET skip: page*limit is a keyset-free offset, so an unbounded page
  // (page=1e6) would make Postgres walk ~100M rows. With limit<=100 and the
  // (status|depot, createdAt) composite indexes, page<=1000 caps the skip at ~100k
  // rows (sub-100ms index walk). No list UI paginates past page 1, so this is a pure
  // DoS guard. ponytail: bounded offset; swap to a cursor param only if an
  // infinite-scroll UI ever needs to page deeper than this (DB-6).
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

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Restrict the staff queue to one depot (6a).',
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({
    description:
      'HQ tray: only orders that reached no depot (legacy rows from when checkout failed open).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unrouted?: boolean;
}

/** HQ fills in the fulfilling depot of an order that has none. */
export class AssignDepotDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;
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

/** Internal (payment-service): a settled refund amount to record on the order (22a). */
export class InternalRefundDto {
  @ApiProperty({ example: 25000, description: 'Refunded amount in rupiah.' })
  @IsNumber()
  @Min(0)
  amount!: number;
}

/** Internal: batch-read the mean rating over a courier's delivered orders (design 4c). */
export class RatingBatchDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Order ids to average reviews over.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  orderIds!: string[];
}

/** Internal: batch-read authoritative order totals for cross-service reporting. */
export class OrderValueBatchDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 500, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  orderIds!: string[];
}

export class OrderValueDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 50_000, description: 'Authoritative order total in integer IDR.' })
  totalIdr!: number;
}

/** Spec 7b: set up a recurring galon delivery. */
export class CreateSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, description: 'Units delivered each cycle.' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] })
  @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY'])
  frequency!: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

  @ApiProperty({ format: 'date-time', description: 'First scheduled delivery.' })
  @IsDateString()
  firstDeliveryAt!: string;

  @ApiProperty({ type: DeliveryAddressDto })
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;
}

/** Optional depot scope: which depot's subscription discount to answer against. */
export class DepotScopeQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: "Depot whose rate applies; omit for the global one.",
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

/** Spec 7c: rate a delivered/completed order. */
export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, description: 'Star rating.' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ type: [String], description: 'Positive aspects tapped by the customer.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  aspects?: string[];

  @ApiPropertyOptional({ description: 'Free-text comment.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Optional courier tip in IDR.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  tipAmount?: number;
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

  @ApiPropertyOptional({ description: 'Courier display name (set on DRIVER_ASSIGNED).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  driverName?: string;

  @ApiPropertyOptional({
    description: 'Courier phone (set on DRIVER_ASSIGNED); lets the customer call the driver.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  driverPhone?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Customer-facing ETA (set on ON_DELIVERY by delivery-service).',
  })
  @IsOptional()
  @IsDateString()
  estimatedArrivalAt?: string;
}

/** One line of a counter sale. */
export class WalkInLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

/** Cash sale at the depot counter. The buyer's phone is optional (anonymous sale). */
export class WalkInSaleDto {
  @ApiProperty({ format: 'uuid', description: 'Depot making the sale.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ type: [WalkInLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WalkInLineDto)
  lines!: WalkInLineDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Resolved customer. Omit for an anonymous sale — no points, no CRM row.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @ApiPropertyOptional({ example: '081234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerPhone?: string;

  @ApiPropertyOptional({
    example: 'HEMAT10',
    description: "Voucher from the buyer's wallet. Requires customerId — a voucher has an owner.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  voucherCode?: string;
}

/** Reversing a counter sale. The reason is required: a short drawer needs its account. */
export class VoidSaleDto {
  @ApiProperty({ example: 'Pembeli salah pilih ukuran galon.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}
