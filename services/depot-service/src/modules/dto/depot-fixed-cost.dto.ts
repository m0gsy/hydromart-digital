import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { monthInRange } from '../../application/services/depot-fixed-cost.service';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

@ValidatorConstraint({ name: 'monthInRange' })
class MonthInRange implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && monthInRange(value);
  }

  defaultMessage(): string {
    return 'month must be YYYY-MM, from 2020 to next year';
  }
}

export class DepotFixedCostsQueryDto {
  @ApiProperty({ example: '2026-11', description: 'WIB year-month.' })
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  @Validate(MonthInRange)
  month!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only this depot.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

// Loose on purpose: a wrong cell must fail ITS row with a message naming the cell, not the whole
// file with a 400. The service holds the real rules.
export class ImportDepotFixedCostRowDto {
  @ApiProperty({ example: 'JKT-01' })
  @IsString()
  @MaxLength(60)
  depotCode!: string;

  @ApiProperty({ example: '2026-11', description: 'YYYY-MM' })
  @IsString()
  @MaxLength(20)
  month!: string;

  @ApiProperty({ example: 'sewa', description: 'Up to 40 characters; stored lower-cased.' })
  @IsString()
  @MaxLength(100)
  category!: string;

  @ApiProperty({ example: 3_500_000, description: 'Whole rupiah, 0 or more.' })
  @IsNumber()
  amountIdr!: number;

  @ApiPropertyOptional({ example: 'kontrak sampai Des 2027' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Service-to-service: the P&L reads many depots' fixed-cost totals for one month in one call. */
export class DepotFixedCostTotalsQueryDto {
  @ApiProperty({ description: 'Comma-separated depot ids (1 to 100).' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter((v) => v.length > 0) : value,
  )
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  depotIds!: string[];

  @ApiProperty({ example: '2026-11' })
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  month!: string;
}

export class DepotFixedCostTotalResponseDto {
  @ApiProperty({ format: 'uuid' })
  depotId!: string;
  @ApiProperty({ description: 'Sum of every category entered for the month, whole rupiah.' })
  totalIdr!: number;
}

export class ImportDepotFixedCostsDto {
  @ApiProperty({ type: [ImportDepotFixedCostRowDto], description: 'Max 500 rows per file.' })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportDepotFixedCostRowDto)
  rows!: ImportDepotFixedCostRowDto[];
}
