import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
