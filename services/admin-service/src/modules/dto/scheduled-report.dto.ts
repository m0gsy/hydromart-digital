import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ExportFormat } from '../../domain/export';
import { ReportCadence } from '../../domain/report-cadence';
import { ScheduledReportRecord } from '../../application/ports/scheduled-report.repository';

/* ---------- Requests ---------- */

export class CreateScheduledReportDto {
  @ApiProperty({ example: 'Daily revenue summary' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: ReportCadence })
  @IsEnum(ReportCadence)
  cadence!: ReportCadence;

  @ApiProperty({ type: [String], example: ['finance@hydromart.id'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  recipients!: string[];

  @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.XLSX })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextRunAt?: Date;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateScheduledReportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ enum: ReportCadence })
  @IsOptional()
  @IsEnum(ReportCadence)
  cadence?: ReportCadence;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  recipients?: string[];

  @ApiPropertyOptional({ enum: ExportFormat })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextRunAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/* ---------- Responses ---------- */

export class ScheduledReportDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: ReportCadence })
  cadence!: ReportCadence;
  @ApiProperty({ type: [String] })
  recipients!: string[];
  @ApiProperty({ enum: ExportFormat })
  format!: ExportFormat;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextRunAt!: string | null;
  @ApiProperty()
  enabled!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: ScheduledReportRecord): ScheduledReportDto {
    return {
      id: record.id,
      name: record.name,
      cadence: record.cadence,
      recipients: record.recipients,
      format: record.format,
      nextRunAt: record.nextRunAt ? record.nextRunAt.toISOString() : null,
      enabled: record.enabled,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
