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

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

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
  @IsNotBefore('from')
  @IsWithinDays('from')
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

/**
 * Monthly review (S2): the cost side of one depot's window. Both bounds required — an
 * open-ended range here would charge one month with the depot's whole history.
 */
export class DepotCostsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ format: 'date-time', description: 'Start of the window (inclusive).' })
  @IsDateString()
  from!: string;

  @ApiProperty({ format: 'date-time', description: 'End of the window (exclusive).' })
  @IsDateString()
  @IsNotBefore('from')
  @IsWithinDays('from')
  to!: string;
}

/**
 * CA-2-22: correcting an entry.
 *
 * A reason, and nothing else — the amount, direction and depot all come from the entry
 * being cancelled. Letting the caller restate them would let a "correction" post a
 * different number against a different depot, which is a new entry wearing a correction's
 * name.
 */
export class ReverseCashbookDto {
  @ApiProperty({
    example: 'Salah ketik: Rp 5.000.000 seharusnya Rp 500.000',
    description: 'Why the entry is being corrected. Shown beside both entries in the book.',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(300)
  reason!: string;
}
