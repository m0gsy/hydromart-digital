import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

import { ExportFormat, ExportStatus } from '../../domain/export';
import { ExportLogRecord } from '../../application/ports/export-log.repository';

/* ---------- Requests ---------- */

export class ExportLogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Exact dataset filter.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  dataset?: string;

  @ApiPropertyOptional({ enum: ExportStatus })
  @IsOptional()
  @IsEnum(ExportStatus)
  status?: ExportStatus;
}

/** Export event posted by a job (internal auth). */
export class IngestExportLogDto {
  @ApiProperty({ example: 'Revenue per depot' })
  @IsString()
  @MaxLength(200)
  dataset!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Requesting account id (null for system jobs).' })
  @IsOptional()
  @IsUUID()
  requestedById?: string;

  @ApiProperty({ example: 'finance@hydromart.id' })
  @IsString()
  @MaxLength(200)
  requestedByEmail!: string;

  @ApiProperty({ enum: ExportFormat })
  @IsEnum(ExportFormat)
  format!: ExportFormat;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  rowCount?: number;

  @ApiPropertyOptional({ enum: ExportStatus, default: ExportStatus.PENDING })
  @IsOptional()
  @IsEnum(ExportStatus)
  status?: ExportStatus;
}

/* ---------- Responses ---------- */

export class ExportLogDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  dataset!: string;
  @ApiProperty({ nullable: true })
  requestedById!: string | null;
  @ApiProperty()
  requestedByEmail!: string;
  @ApiProperty({ enum: ExportFormat })
  format!: ExportFormat;
  @ApiProperty({ nullable: true })
  rowCount!: number | null;
  @ApiProperty({ enum: ExportStatus })
  status!: ExportStatus;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: ExportLogRecord): ExportLogDto {
    return {
      id: record.id,
      dataset: record.dataset,
      requestedById: record.requestedById,
      requestedByEmail: record.requestedByEmail,
      format: record.format,
      rowCount: record.rowCount,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
