import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Past attendance, one row per employee per day. */
export class ImportAttendanceRowDto {
  @IsString() @MaxLength(40) employeeCode!: string;
  @Matches(DAY, { message: 'workDate harus format YYYY-MM-DD' }) workDate!: string;
  @IsIn(['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY'])
  status!: 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HOLIDAY';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) lateMinutes?: number;
}

export class ImportAttendanceDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportAttendanceRowDto)
  rows!: ImportAttendanceRowDto[];
}

/** One closed payslip from before the app. */
export class ImportPayrollRowDto {
  @IsString() @MaxLength(40) employeeCode!: string;
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth!: string;
  @Type(() => Number) @IsInt() @Min(0) gross!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) totalBonus?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) totalDeduction?: number;
  @IsOptional() @Type(() => Number) @IsInt() net?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) presentDays?: number;
}

export class ImportPayrollDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportPayrollRowDto)
  rows!: ImportPayrollRowDto[];
}

/** Who worked which shift from when. The shift is named, not given by id. */
export class ImportShiftRowDto {
  @IsString() @MaxLength(40) employeeCode!: string;
  @IsString() @MaxLength(100) shiftName!: string;
  @Matches(DAY, { message: 'effectiveFrom harus format YYYY-MM-DD' }) effectiveFrom!: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ImportShiftsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportShiftRowDto)
  rows!: ImportShiftRowDto[];
}
