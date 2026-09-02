import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaymentMethod, PaymentStatus } from '../../domain/payment';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

export class InitiatePaymentDto {
  @ApiProperty({ format: 'uuid', description: 'The order being paid for.' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({ example: 45000, description: 'Amount to charge, in IDR.' })
  @Type(() => Number)
  @IsPositive()
  amount!: number;
}

/**
 * Counter sale: staff take the cash on the buyer's behalf, so the payer cannot be inferred
 * from the token the way it is for a customer-initiated payment.
 */
export class StaffInitiatePaymentDto extends InitiatePaymentDto {
  @ApiProperty({ format: 'uuid', description: 'Customer the payment belongs to.' })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "Depot whose drawer takes the money — what the cashier's shift is measured against.",
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

/** Counter void: reverse whatever payment the order has, named by the order. */
export class VoidForOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'Pembeli salah pilih ukuran galon.' })
  @IsString()
  @MaxLength(255)
  reason!: string;

  /**
   * Which service reversed it. Optional, defaulting to the historical `order-service` so
   * the counter-void caller keeps working unchanged.
   *
   * CA-4-03: this route stopped having exactly one caller. delivery-service now uses it
   * when a courier hands cash back at the door, and the payment history was recording
   * `order-service` for both — naming the wrong actor on a money reversal, which is the
   * same class of defect as CA-2-67 ("perubahan setelan uang tidak pernah masuk log").
   */
  @ApiPropertyOptional({ example: 'delivery-service' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  changedBy?: string;
}

/** Shift close: how much cash one depot took over the shift window. */
export class DepotCashQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Start of the window (inclusive).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'End of the window (inclusive).' })
  @IsOptional()
  @IsDateString()
  @IsNotBefore('from')
  @IsWithinDays('from')
  to?: string;

  /**
   * C2: the shift asking. Present = "this drawer's cash" (its own payments plus any that
   * predate the column and fall in the window). Absent = the whole depot over the window,
   * which is what the daily report wants.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'The cashier shift asking, if it is a shift close.' })
  @IsOptional()
  @IsUUID()
  cashierShiftId?: string;
}

/**
 * Daily report: the PAID cash on a depot's day, order by order.
 *
 * A POST with a body rather than a query string — a busy depot's day is hundreds of order
 * ids, which is past what a URL can carry. Bounded at 1.000 so one caller cannot ask the
 * payment book for the whole network in a single read.
 */
export class CashByOrderDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 1000 })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  orderIds!: string[];
}

/**
 * Depot reconciliation: the payments behind one page of a depot's orders.
 *
 * Bounded at 100 — one screen's worth. The daily report above asks for a whole day and is
 * bounded at 1.000; this is a console table, and letting it ask for the same volume would
 * turn a page render into a report run.
 */
export class PaymentsForOrdersDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  orderIds!: string[];
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Keyset cursor from the previous response (`nextCursor`). Reads the next page ' +
      'without an OFFSET; `page` is ignored when this is given.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

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
}

export class UnsettledByMethodQueryDto {
  @ApiPropertyOptional({ format: 'date-time', description: 'Start of the window (inclusive).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'End of the window (inclusive).' })
  @IsOptional()
  @IsDateString()
  @IsNotBefore('from')
  @IsWithinDays('from')
  to?: string;
}

export class CashCollectedQueryDto {
  @ApiProperty({
    description: 'Comma-separated order UUIDs to sum PAID cash over (max 500).',
    example: '1a2b…,3c4d…',
  })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  orderIds!: string[];
}

export class ConfirmPaymentDto {
  @ApiPropertyOptional({
    example: 50000,
    description: 'COD cash handed over (IDR). Change owed back is computed and returned.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  cashReceived?: number;

  /**
   * K2.9: when the courier actually took the cash, for a COD confirmed from the offline
   * queue. Clamped by the service — never later than now, never older than the queue's own
   * retention — because shift close reads `paidAt` to decide whose drawer the notes belong
   * to. Absent means "now", which is what every online confirmation sends.
   */
  @ApiPropertyOptional({
    example: '2026-08-24T09:00:00.000Z',
    description: 'Device capture time for an offline-queued COD confirmation (ISO 8601).',
  })
  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}

export class RefundPaymentDto {
  @ApiPropertyOptional({ example: 'Order cancelled by customer.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class PaymentWebhookDto {
  @ApiProperty({ description: 'Provider charge reference.' })
  @IsString()
  @MaxLength(200)
  reference!: string;

  @ApiProperty({ enum: ['PAID', 'FAILED'] })
  @IsIn(['PAID', 'FAILED'])
  event!: 'PAID' | 'FAILED';

  @ApiProperty({
    example: 1785800000000,
    description:
      'Epoch milliseconds the provider signed at. Must be within 5 minutes of server time — ' +
      'it is inside the HMAC, so it cannot be edited to refresh a captured request.',
  })
  @Type(() => Number)
  @IsInt()
  timestamp!: number;

  @ApiProperty({
    description:
      'HMAC-SHA256, with the webhook secret, over every field of this payload except ' +
      '`signature`: sorted by key and joined as `k=v&k=v`.',
  })
  @IsString()
  @MaxLength(200)
  signature!: string;
}

/** Window + threshold for the repeated-refund fraud scan (15b, internal auth). */
export class RefundCountsQueryDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  from!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  to!: string;

  @ApiProperty({ minimum: 2, maximum: 100, description: 'Least refunds to be reported.' })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  minRefunds!: number;
}

/**
 * The refund rule the HQ queue states in its own subtitle.
 *
 * `REFUND_HQ_THRESHOLD` is an env var: an operator can raise it and no screen notices.
 * The subtitle of the queue is precisely the sentence that must not drift from the rule
 * that decides what lands in the queue, so it reads the number instead of asserting it.
 */
export class RefundRulesDto {
  @ApiProperty({ description: 'Refunds above this amount need HQ approval first.' })
  hqApprovalThresholdIdr!: number;
}
