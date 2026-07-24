import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Max base64 length for one captured frame (~1.4 MB decoded). */
const MAX_FRAME = 2_000_000;

export class EnrollFaceDto {
  /** Base64 (or data-URL) aligned face frames captured by the PWA. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(MAX_FRAME, { each: true })
  images!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourcePhotoUrl?: string;
}

export class FacePunchDto {
  /** Base64 (or data-URL) aligned probe frame. */
  @IsString()
  @MaxLength(MAX_FRAME)
  image!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  /** Client passive-liveness verdict (blink/head-turn challenge). */
  @IsOptional()
  @IsBoolean()
  live?: boolean;
}

const ATTENDANCE_STATUS = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY'] as const;

export class AdjustAttendanceDto {
  @IsOptional() @IsIn(ATTENDANCE_STATUS) status?: (typeof ATTENDANCE_STATUS)[number];
  @IsOptional() @IsISO8601() checkInAt?: string;
  @IsOptional() @IsISO8601() checkOutAt?: string;
  @IsOptional() @IsInt() @Min(0) lateMinutes?: number;
  @IsString() @MaxLength(200) reason!: string;
}

export class ManualAttendanceDto {
  @IsUUID() employeeId!: string;
  @IsISO8601() workDate!: string;
  @IsIn(ATTENDANCE_STATUS) status!: (typeof ATTENDANCE_STATUS)[number];
  @IsString() @MaxLength(200) reason!: string;
}

export class ListAttendanceDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize = 30;
}
