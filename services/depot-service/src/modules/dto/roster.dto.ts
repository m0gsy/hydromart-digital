import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { ShiftKind } from '../../domain/shift';

/** ISO date of the week's Monday, e.g. "2026-07-14". */
const WEEK_START = { format: 'date', example: '2026-07-14', description: "ISO date of the week's Monday." };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListRosterQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to read the roster for.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty(WEEK_START)
  @IsString()
  @Matches(ISO_DATE, { message: 'weekStart must be an ISO date (YYYY-MM-DD).' })
  weekStart!: string;
}

/** One cell: a staff member's shift on one day (0=Mon..6=Sun). */
export class ShiftCellDto {
  @ApiProperty({ format: 'uuid', description: 'Staff/courier account id.' })
  @IsUUID()
  staffId!: string;

  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  staffName!: string;

  @ApiProperty({ minimum: 0, maximum: 6, description: '0=Mon .. 6=Sun.' })
  @IsInt()
  @Min(0)
  @Max(6)
  day!: number;

  @ApiProperty({ enum: ShiftKind })
  @IsEnum(ShiftKind)
  shift!: ShiftKind;
}

/** Set a single cell (PUT /shifts). Carries the week scope + the cell. */
export class SetShiftDto extends ShiftCellDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the roster belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty(WEEK_START)
  @IsString()
  @Matches(ISO_DATE, { message: 'weekStart must be an ISO date (YYYY-MM-DD).' })
  weekStart!: string;
}

/** Set many cells of one week at once (PUT /shifts/bulk). */
export class BulkRosterDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the roster belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty(WEEK_START)
  @IsString()
  @Matches(ISO_DATE, { message: 'weekStart must be an ISO date (YYYY-MM-DD).' })
  weekStart!: string;

  @ApiProperty({ type: [ShiftCellDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ShiftCellDto)
  cells!: ShiftCellDto[];
}
