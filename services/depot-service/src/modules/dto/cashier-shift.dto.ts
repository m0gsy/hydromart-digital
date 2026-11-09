import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Max, Min, MinLength } from 'class-validator';

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

export class ShiftQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;
}
