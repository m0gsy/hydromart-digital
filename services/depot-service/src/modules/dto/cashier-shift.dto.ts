import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotBefore, IsWithinDays } from '@hydromart/platform';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, IsUUID, MaxLength, Max, Min, MinLength } from 'class-validator';

// A drawer float and a counted total are whole rupiah. The ceiling is deliberately absurd
// (Rp 1 miliar) — it only exists to reject a fat-fingered paste, not to cap a real day.
const MAX_IDR = 1_000_000_000;

export class OpenShiftDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({
    example: 200000,
    description: 'Change money in the drawer before the first sale.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_IDR)
  openingFloat!: number;
}

export class CloseShiftDto {
  @ApiProperty({ example: 1450000, description: 'What the cashier physically counted.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_IDR)
  countedCash!: number;

  @ApiPropertyOptional({ example: 'Selisih karena kembalian kurang Rp 2.000.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SettleLiabilityDto {
  @ApiProperty({ example: 'Dilunasi tunai oleh kasir pada 10 Nov.', description: 'Why it is closed: paid, waived, ...' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

/** HD-6 H2: a depot and a window of instants `[from, to)`. */
export class ShiftVarianceQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: '2026-10-31T17:00:00.000Z' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-11-30T17:00:00.000Z', description: 'Exclusive; not before `from`, at most 400 days later.' })
  @IsISO8601()
  @IsNotBefore('from')
  @IsWithinDays('from', 400)
  to!: string;
}

export class ShiftQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;
}
