import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { LeaveStatus, LeaveType } from '../../../prisma/generated/client';

export class SubmitLeaveDto {
  @IsEnum(LeaveType) type!: LeaveType;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
  @IsString() @MaxLength(300) reason!: string;
  /** Doctor's note or similar; the upload itself is out of scope for this milestone. */
  @IsOptional() @IsString() @MaxLength(500) attachmentUrl?: string;
}

export class DecideLeaveDto {
  @IsBoolean() approve!: boolean;
  /** Required when rejecting — the employee reads it. */
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ListLeaveDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsEnum(LeaveStatus) status?: LeaveStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 20;
}

export class LeaveBalanceQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) year?: number;
}

/** One opening-balance row: carried-over quota and days already taken, by staff code. */
export class ImportLeaveBalanceRowDto {
  @IsString() @MaxLength(40) employeeCode!: string;
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(365) quotaDays!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) usedDays?: number;
}

export class ImportLeaveBalancesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportLeaveBalanceRowDto)
  rows!: ImportLeaveBalanceRowDto[];
}
