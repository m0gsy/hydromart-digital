import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsUUID } from 'class-validator';

import { CashDirection } from '../../domain/cashbook';

export class ListCashbookQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list cashbook entries for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ description: 'Lower occurredAt bound (inclusive), ISO date.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Upper occurredAt bound (inclusive), ISO date.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class CreateCashbookDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the entry belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ enum: CashDirection })
  @IsEnum(CashDirection)
  direction!: CashDirection;

  @ApiProperty({ example: 'COD', description: 'Short category tag.' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  category!: string;

  @ApiProperty({ example: 'Setoran COD kurir Budi' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;

  @ApiProperty({ example: 250_000 })
  @IsInt()
  @Min(1)
  amountIdr!: number;

  @ApiPropertyOptional({ description: 'When the movement happened; defaults to now.' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
