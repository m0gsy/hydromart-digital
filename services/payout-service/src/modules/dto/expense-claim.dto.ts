import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

  @ApiPropertyOptional({ format: 'uuid', description: 'Courier assigned depot (for reviewer filter).' })
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
