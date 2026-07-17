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

  @ApiProperty({ description: 'HMAC-SHA256 of `${reference}.${event}` with the webhook secret.' })
  @IsString()
  @MaxLength(200)
  signature!: string;
}
