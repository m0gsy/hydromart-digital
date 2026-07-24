import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
