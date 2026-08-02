import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Partial write. The morning call sends `openingM3`, the evening one `closingM3`;
 * the same route serves both, so every field is optional and the service validates
 * the merged row rather than the patch.
 */
export class SaveMeterReadingDto {
  @ApiPropertyOptional({ example: 1245.32, description: 'Opening dial reading in m³.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  openingM3?: number;

  @ApiPropertyOptional({ example: 1247.92, description: 'Closing dial reading in m³.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  closingM3?: number;

  @ApiPropertyOptional({ description: 'Raw-water intake meter, opening (m³). Optional.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  sourceOpeningM3?: number;

  @ApiPropertyOptional({ description: 'Raw-water intake meter, closing (m³). Optional.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  sourceClosingM3?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MeterHistoryQueryDto {
  @ApiPropertyOptional({ example: '2026-07-01', description: 'Inclusive start date.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31', description: 'Inclusive end date.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
