import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestWithdrawalDto {
  @ApiProperty({ example: 8420000, description: 'IDR amount to withdraw (positive).' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'BCA ···· 4821', description: 'Masked destination bank account.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bankAccountRef!: string;
}

export class ReleasePayoutDto {
  @ApiProperty({ format: 'uuid', description: 'Franchise owner whose balance HQ is releasing.' })
  @IsUUID()
  franchiseOwnerId!: string;
}

/** Internal push from order-service when an order reaches COMPLETED (design 6a). */
export class OrderRevenueDto {
  @ApiProperty({ format: 'uuid', description: 'Completed order; also the idempotency key.' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ format: 'uuid', description: 'Owner of the fulfilling depot.' })
  @IsUUID()
  franchiseOwnerId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  depotId?: string | null;

  @ApiProperty({ example: 240000, description: 'Order total in whole IDR.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amountIdr!: number;

  @ApiPropertyOptional({
    example: 'HM-20260728-000123',
    description: 'Shown in the ledger description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderNumber?: string | null;

  @ApiPropertyOptional({ description: 'Completion timestamp; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  completedAt?: string;
}

export class LedgerQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
