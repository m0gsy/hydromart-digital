import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsNotBefore, IsWithinDays, decimalMax } from '@hydromart/platform';

/**
 * Partial write. The morning call sends `openingM3`, the evening one `closingM3`;
 * the same route serves both, so every field is optional and the service validates
 * the merged row rather than the patch.
 */
export class SaveMeterReadingDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'CA-2-53: the `updatedAt` this edit started from. The write is refused (409) if the stored row has moved since.',
  })
  @IsOptional()
  @IsISO8601()
  seenUpdatedAt?: string;

  @ApiPropertyOptional({ example: 1245.32, description: 'Opening dial reading in m³.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(decimalMax(12, 3))
  openingM3?: number;

  @ApiPropertyOptional({ example: 1247.92, description: 'Closing dial reading in m³.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(decimalMax(12, 3))
  closingM3?: number;

  @ApiPropertyOptional({ description: 'Raw-water intake meter, opening (m³). Optional.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(decimalMax(12, 3))
  sourceOpeningM3?: number;

  @ApiPropertyOptional({ description: 'Raw-water intake meter, closing (m³). Optional.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(decimalMax(12, 3))
  sourceClosingM3?: number;

  @ApiPropertyOptional({ example: 72, description: '#24: tank level at opening, 0..100%.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  openingTankPct?: number;

  @ApiPropertyOptional({ example: 65, description: '#24: tank level at closing, 0..100%.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  closingTankPct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Required when the date is before today (business time zone): why a previous day is corrected. Stamped with the corrector and the time.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  correctionReason?: string;
}

export class MeterHistoryQueryDto {
  @ApiPropertyOptional({ example: '2026-07-01', description: 'Inclusive start date.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31', description: 'Inclusive end date.' })
  @IsOptional()
  @IsISO8601()
  @IsNotBefore('from')
  @IsWithinDays('from')
  to?: string;
}
