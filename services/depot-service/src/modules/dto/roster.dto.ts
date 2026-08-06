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
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

import { ShiftKind } from '../../domain/shift';

/** ISO date of the week's Monday, e.g. "2026-07-14". */
const WEEK_START = {
  format: 'date',
  example: '2026-07-14',
  description: "ISO date of the week's Monday.",
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * B5: the week key must actually be a Monday.
 *
 * The DTOs matched the SHAPE and nothing else, while the unique key is
 * `@@unique([depotId, weekStart, staffId, day])` on that string as typed. Send a Wednesday
 * and the same week is stored twice as two parallel grids — days off already filled in
 * "disappear", because they are being read under a different week key. The web page always
 * sends `mondayOf()`, but the bulk route is open on the gateway and is already driven by
 * scripts.
 *
 * REFUSED, not normalised. Silently rounding back to Monday would write to a week the
 * caller did not ask for, which is the same class of surprise one rung quieter.
 */
@ValidatorConstraint({ name: 'isMonday', async: false })
export class IsMondayConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
    const at = new Date(`${value}T00:00:00.000Z`);
    // getUTCDay() is 1 for Monday. Read in UTC on purpose: the string carries no zone, and
    // the local one would make the same date a Monday in Jakarta and a Sunday in London.
    return !Number.isNaN(at.getTime()) && at.getUTCDay() === 1;
  }
  defaultMessage(): string {
    return 'weekStart must be the Monday of the week (YYYY-MM-DD).';
  }
}

export class ListRosterQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to read the roster for.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty(WEEK_START)
  @IsString()
  @Matches(ISO_DATE, { message: 'weekStart must be an ISO date (YYYY-MM-DD).' })
  @Validate(IsMondayConstraint)
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
  @Validate(IsMondayConstraint)
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
  @Validate(IsMondayConstraint)
  weekStart!: string;

  @ApiProperty({ type: [ShiftCellDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ShiftCellDto)
  cells!: ShiftCellDto[];
}
