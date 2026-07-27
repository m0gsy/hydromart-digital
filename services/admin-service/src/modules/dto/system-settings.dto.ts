import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

import { IsIanaTimezone } from '@hydromart/platform';

import { SystemSettingsRecord } from '../../application/ports/system-settings.repository';

/* ---------- Requests ---------- */

export class SaveSystemSettingsDto {
  @ApiProperty({ example: 'Asia/Jakarta', description: 'Default IANA timezone.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @IsIanaTimezone()
  defaultTimezone!: string;

  // Locked to IDR. Prices are stored and rendered as plain integer rupiah throughout —
  // there is no FX rate, no minor-unit handling and no per-currency formatting — so any
  // other value used to save happily and then change nothing, which reads as support
  // that is not there. Widen this only alongside real multi-currency pricing.
  @ApiProperty({ example: 'IDR', enum: ['IDR'], description: 'ISO-4217 currency code; only IDR is supported.' })
  @IsIn(['IDR'], { message: 'currency hanya mendukung IDR' })
  currency!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 100, description: 'Default depot service radius (km).' })
  @IsInt()
  @Min(1)
  @Max(100)
  serviceRadiusKm!: number;
}

/* ---------- Responses ---------- */

export class SystemSettingsDto {
  @ApiProperty({ example: 'Asia/Jakarta' })
  defaultTimezone!: string;
  @ApiProperty({ example: 'IDR' })
  currency!: string;
  @ApiProperty({ example: 5 })
  serviceRadiusKm!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: SystemSettingsRecord): SystemSettingsDto {
    return {
      defaultTimezone: record.defaultTimezone,
      currency: record.currency,
      serviceRadiusKm: record.serviceRadiusKm,
      updatedAt: record.updatedAt,
    };
  }
}
