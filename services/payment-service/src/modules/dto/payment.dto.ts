import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
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

import { IsNotBefore } from '@hydromart/platform';

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
  to?: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

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
