import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
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
  // @ValidateNested() says nothing about a field that is absent: without @IsDefined() a body
  // with no address validates clean and reaches the service as `undefined` — a 500 for a
  // request that was only ever the wrong shape.
  @IsDefined()
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

  @ApiPropertyOptional({
    example: true,
    description:
      'Express ("antar sekarang") instead of a scheduled window. The surcharge is read from the depot\'s settings server-side; no price is accepted from the client.',
  })
  @IsOptional()
  @IsBoolean()
  express?: boolean;
}

/** What the checkout screen may offer for delivery timing at one depot. */
export class DeliveryOptionsResponseDto {
  @ApiProperty({ example: ['09.00-11.00', '11.00-13.00'] })
  slots!: string[];

  @ApiProperty({ example: true })
  expressEnabled!: boolean;

  @ApiProperty({ example: 5000, description: 'Surcharge in IDR, charged on the order.' })
  expressFee!: number;

  @ApiProperty({ example: 30 })
  expressEtaMinMinutes!: number;

  @ApiProperty({ example: 60 })
  expressEtaMaxMinutes!: number;
}

export class ListOrdersQueryDto {
  /**
   * C6: counter sales only. Opt-in — absent means "either", so no existing list moves.
   *
   * The till uses it to show its OWN recent sales, which is what makes the void endpoint
   * reachable after a refresh and what turns the same list into the void report the app
   * never had.
   */
  @ApiPropertyOptional({ type: Boolean, description: 'Counter sales only.' })
  @IsOptional()
  // class-transformer never invokes this for an absent key, so the `undefined` guard the
  // first draft carried was a branch nothing could reach. An absent `isWalkIn` stays
  // absent because the transform is not called at all — asserted below.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isWalkIn?: boolean;

  // Bound the OFFSET skip: page*limit is an offset, so an unbounded page (page=1e6)
  // would make Postgres walk ~100M rows. With limit<=100 and the (status|depot,
  // createdAt) composite indexes, page<=1000 caps the skip at ~100k rows.
  //
  // `cursor` below is the way past that ceiling without an offset at all (audit Q-16):
  // pass the previous response's `nextCursor` and the read seeks straight to that row.
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

  @ApiPropertyOptional({
    description:
      'Keyset cursor from the previous response (`nextCursor`). Reads the next page ' +
      'without an OFFSET; `page` is ignored when this is given.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

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

  // Audit F-12: HQ global search used to pull a page of orders and match order numbers
  // in the browser, so it only ever found the twenty most recent.
  @ApiPropertyOptional({ description: 'Case-insensitive substring of the order number.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderNumber?: string;
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

  @ApiProperty({ example: 'HM-20260806-1000001', description: 'Human-readable order number.' })
  orderNumber!: string;

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
  // @ValidateNested() says nothing about a field that is absent: without @IsDefined() a body
  // with no address validates clean and reaches the service as `undefined` — a 500 for a
  // request that was only ever the wrong shape.
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;
}

/**
 * K1.9: move a standing plan to a different address.
 *
 * The whole snapshot, not an address-book id: the plan holds its own copy on purpose, so
 * that editing an address book entry cannot silently re-route a standing order or change
 * which depot prices it (D7). Sending the same shape the create route takes keeps those
 * two facts identical rather than nearly identical.
 */
export class ChangeSubscriptionAddressDto {
  @ApiProperty({ type: DeliveryAddressDto })
  // `@ValidateNested()` alone passes an ABSENT object — it validates what is there, and
  // nothing is there. The route then reads `.recipientName` off undefined and answers 500
  // to a request that is simply malformed. `@IsDefined()` is what makes it a 400.
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;
}

/**
 * D10: what depot-service sends when an operator sets a subscription up for a customer.
 *
 * Same shape as the customer's own, minus the address — the engine reads the customer's
 * primary one. An operator typing an address on somebody else's behalf is how the
 * unroutable plans D3 refuses were created.
 */
export class CreateSubscriptionForCustomerDto {
  @ApiProperty({ format: 'uuid', description: 'Registered customer the plan is for.' })
  @IsUUID()
  customerId!: string;

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
  /**
   * C11: the buyer came to the depot and asked for it to be delivered.
   *
   * Optional on purpose — present means deliver, absent means today's behaviour exactly.
   * No new enum and no new route: the system had only two ways to create an order, and
   * neither could produce a counter sale a courier would carry.
   */
  @ApiPropertyOptional({ type: DeliveryAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

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

/**
 * C12: what the cashier screen asks the server to price.
 *
 * Deliberately NO phone field. Resolving a phone mints an account, so a quote that took
 * one would print a customer on every keystroke — people who never bought anything,
 * sitting in the broadcast audience, who will never turn the opt-out off because nobody is
 * behind them. `customerId` arrives only after the cashier taps to identify the buyer.
 */
export class CounterQuoteDto {
  @ApiProperty({ format: 'uuid', description: 'Depot pricing the basket.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ type: [WalkInLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WalkInLineDto)
  lines!: WalkInLineDto[];

  @ApiPropertyOptional({ format: 'uuid', description: 'The buyer, once the cashier has identified them.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'HEMAT10', description: 'Rejected here rather than at Bayar.' })
  /**
   * C11: the buyer asked for it to be delivered. Optional — absent quotes a pick-up, exactly
   * as before. Present makes the quote include the ongkir, so the number on the till is the
   * number the sale will charge.
   */
  @ApiPropertyOptional({ type: DeliveryAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  voucherCode?: string;
}

/** C12: the deliberate tap that identifies a counter buyer — the one call that may create an account. */
export class CounterIdentifyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: '081234567890' })
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiPropertyOptional({ example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

/** C12: the priced basket. `total` is what the till charges — the screen stops adding up. */
export class CounterQuoteResponseDto {
  @ApiProperty({ example: 60000, description: 'Shelf prices at this depot, before the discount layer.' })
  subtotalIdr!: number;

  @ApiProperty({ example: 15000, description: 'Tier, agen price or voucher — the layer only the server knows.' })
  discountIdr!: number;

  @ApiProperty({ example: 45000, description: 'What the buyer pays. The cash guard and the change both use this.' })
  totalIdr!: number;

  /**
   * C11: the ongkir already inside `totalIdr`, 0 for a pick-up.
   *
   * Its own line because a cashier taking cash has to be able to say what the extra is for —
   * and because the quote and the sale must agree on it to the rupiah. They used to differ
   * by exactly this number: the sale charged `subtotal + ongkir - diskon` and the quote
   * answered `subtotal - diskon`.
   */
  @ApiProperty({ example: 5000, description: 'Delivery fee included in the total, in rupiah.' })
  shippingIdr!: number;

  @ApiProperty({ example: false, description: 'The agen band priced this basket.' })
  agen!: boolean;

  @ApiProperty({ nullable: true, example: null, description: 'Set when depot prices were unreachable and the catalogue was used.' })
  catalogFallback!: string | null;

  static from(quote: {
    subtotal: number;
    discount: number;
    total: number;
    agen: boolean;
    catalogFallback: string | null;
    shippingFee: number;
  }): CounterQuoteResponseDto {
    return {
      subtotalIdr: quote.subtotal,
      discountIdr: quote.discount,
      totalIdr: quote.total,
      shippingIdr: quote.shippingFee,
      agen: quote.agen,
      catalogFallback: quote.catalogFallback,
    };
  }
}

/** C12: who the cashier just identified. The screen re-quotes with this id. */
export class CounterBuyerResponseDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;
}
