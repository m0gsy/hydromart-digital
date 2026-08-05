import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Max base64 length for one captured frame (~1.4 MB decoded). */
export const MAX_FRAME = 2_000_000;
/** Max frames one enrollment may carry. */
export const MAX_FRAMES = 10;
/**
 * B-15: the JSON body budget the face routes need, derived from the two limits above so
 * they cannot drift apart again. Express defaults to 100 KB — a real selfie was rejected
 * with a bare 413 before validation ever ran, ~200× under what these DTOs accept.
 */
export const FACE_BODY_LIMIT = MAX_FRAME * MAX_FRAMES + 64 * 1024;

export class EnrollFaceDto {
  /** Base64 (or data-URL) aligned face frames captured by the PWA. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FRAMES)
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

  /**
   * Client passive-liveness verdict (blink/head-turn challenge). ACCEPTED AND IGNORED:
   * a self-asserted anti-spoofing result is not a security control (B-7). Still accepted
   * so punches queued on a device before this deploy — and any installed PWA still sending
   * it — are not rejected by the strict validation pipe.
   */
  @IsOptional()
  @IsBoolean()
  live?: boolean;

  /** GPS captured at punch time (FR + GPS + timestamp). Required for check-in/out. */
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;

  /**
   * Device time this punch was taken, for a punch queued offline. Absent = live punch, which
   * keeps using the server clock. Never trusted raw — the service clamps it.
   */
  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}

const ATTENDANCE_STATUS = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY'] as const;

export class AdjustAttendanceDto {
  @IsOptional() @IsIn(ATTENDANCE_STATUS) status?: (typeof ATTENDANCE_STATUS)[number];
  @IsOptional() @IsISO8601() checkInAt?: string;
  @IsOptional() @IsISO8601() checkOutAt?: string;
  @IsOptional() @IsInt() @Min(0) lateMinutes?: number;
  // Both attendance writes land in the HR audit trail, and an entry whose justification
  // is an empty string is indistinguishable from no justification at all. @IsString alone
  // accepts '' — require real text.
  @IsString() @IsNotEmpty() @MaxLength(200) reason!: string;
}

export class ManualAttendanceDto {
  @IsUUID() employeeId!: string;
  @IsISO8601() workDate!: string;
  @IsIn(ATTENDANCE_STATUS) status!: (typeof ATTENDANCE_STATUS)[number];
  // Both attendance writes land in the HR audit trail, and an entry whose justification
  // is an empty string is indistinguishable from no justification at all. @IsString alone
  // accepts '' — require real text.
  @IsString() @IsNotEmpty() @MaxLength(200) reason!: string;
}

const DECISIONS = ['APPROVE', 'REJECT'] as const;

export class DecideAttendanceDto {
  @IsIn(DECISIONS) decision!: (typeof DECISIONS)[number];
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class ListAttendanceDto {
  @IsOptional() @IsUUID() depotId?: string;
  /** Filter by outcome; the approval queue asks for PENDING. */
  @IsOptional() @IsIn([...ATTENDANCE_STATUS, 'PENDING']) status?: string;
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
