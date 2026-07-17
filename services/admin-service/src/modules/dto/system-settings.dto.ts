import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

import { SystemSettingsRecord } from '../../application/ports/system-settings.repository';

/* ---------- Requests ---------- */

export class SaveSystemSettingsDto {
  @ApiProperty({ example: 'Asia/Jakarta', description: 'Default IANA timezone.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  defaultTimezone!: string;

  @ApiProperty({ example: 'IDR', description: 'ISO-4217 currency code.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
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
