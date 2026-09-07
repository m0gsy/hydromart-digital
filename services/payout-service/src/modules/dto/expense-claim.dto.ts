import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
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

import { ExpenseCategory, ExpenseClaimStatus } from '../../domain/expense-claim';

const CATEGORIES: ExpenseCategory[] = ['FUEL', 'PARKING_TOLL', 'VEHICLE_REPAIR', 'OTHER'];
const STATUSES: ExpenseClaimStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export class SubmitExpenseDto {
  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category!: ExpenseCategory;

  @ApiProperty({ example: 25000, description: 'IDR amount claimed (positive).' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'Bensin motor shift pagi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(280)
  description!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Courier assigned depot (for reviewer filter).',
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ description: 'Receipt photo URL, if attached.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptUrl?: string;
}

export class ReviewExpenseDto {
  @ApiPropertyOptional({ description: 'Optional reviewer note.' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

export class ExpenseQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ExpenseClaimStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

/**
 * CA-2-59: the window and the depots the network P&L is asking about.
 *
 * Comma-separated ids rather than a repeated query parameter, matching hr-service's
 * `internal/depot-summaries` — one shape for "many depots, one call" across the internal
 * routes, so a BFF author does not have to remember which service chose which.
 */
export class DepotPayoutCostsQueryDto {
  @ApiProperty({ example: 'uuid-a,uuid-b', description: 'Comma-separated depot ids.' })
  @IsString()
  depotIds!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  from!: string;

  @ApiProperty({ format: 'date-time', description: 'Exclusive end of the window.' })
  @IsDateString()
  to!: string;
}
