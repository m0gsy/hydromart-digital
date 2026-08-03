import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  BackupStatusRecord,
  RetentionPolicyRecord,
} from '../../application/ports/retention.repository';
import { DataClass } from '../../domain/retention';
import { PurgePlanEntry } from '../../application/services/retention.service';

/* ---------- Requests ---------- */

/** Update just a dataset's retention window (PUT). */
export class UpdateRetentionDto {
  @ApiProperty({ example: '7 tahun (UU PDP)', description: 'Human-readable window label.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  windowLabel!: string;

  @ApiProperty({ example: 2555, minimum: 1, maximum: 36500, description: 'Window length in days.' })
  @IsInt()
  @Min(1)
  @Max(36_500)
  windowDays!: number;

  @ApiPropertyOptional({
    enum: DataClass,
    description: 'M23-21. Omit to keep the current class. FINANCIAL enforces a 10-year floor.',
  })
  @IsOptional()
  @IsEnum(DataClass)
  dataClass?: DataClass;
}

/* ---------- Responses ---------- */

export class RetentionPolicyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  dataset!: string;
  @ApiProperty()
  windowLabel!: string;
  @ApiProperty()
  windowDays!: number;
  @ApiProperty({
    enum: DataClass,
    description: 'M23-21 data class. FINANCIAL is never purged, whatever the window says.',
  })
  dataClass!: DataClass;
  @ApiProperty({
    description: 'Derived from dataClass — true means a purge must skip this dataset.',
  })
  purgeExempt!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  static from(record: RetentionPolicyRecord): RetentionPolicyDto {
    return {
      id: record.id,
      dataset: record.dataset,
      windowLabel: record.windowLabel,
      windowDays: record.windowDays,
      dataClass: record.dataClass,
      purgeExempt: record.purgeExempt,
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

/** Read-only backup status — labeled honestly ("NONE" = no backup engine has run). */
/**
 * What the nightly dump and the weekly restore drill last reported (H-37).
 *
 * The two verdicts stay separate (H-36): a dump that exists and a dump that has been
 * restored into a scratch database are different claims, and only the second one is a
 * backup you can rely on.
 */
export class BackupStatusDto {
  @ApiProperty({ example: 'OK', description: 'NONE = never run | OK | FAILED.' })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastBackupAt!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '1.2G, 16 databases' })
  detail!: string | null;
  @ApiProperty({ example: 'OK', description: 'Tested-restore verdict: NONE | OK | FAILED.' })
  drillStatus!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastDrillAt!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '16 databases, 1,204 rows in orders' })
  drillDetail!: string | null;

  static from(record: BackupStatusRecord): BackupStatusDto {
    return {
      status: record.status,
      lastBackupAt: record.lastBackupAt ? record.lastBackupAt.toISOString() : null,
      detail: record.detail,
      drillStatus: record.drillStatus,
      lastDrillAt: record.lastDrillAt ? record.lastDrillAt.toISOString() : null,
      drillDetail: record.drillDetail,
    };
  }
}

/** Body of POST /retention/internal/backup-status — posted by the shell jobs on the VPS. */
export class RecordBackupRunDto {
  @ApiProperty({ enum: ['BACKUP', 'DRILL'] })
  @IsIn(['BACKUP', 'DRILL'])
  kind!: 'BACKUP' | 'DRILL';

  @ApiProperty({ enum: ['OK', 'FAILED'] })
  @IsIn(['OK', 'FAILED'])
  status!: 'OK' | 'FAILED';

  @ApiPropertyOptional({ description: 'Size, database count, or the failure. Free text.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}

export class RetentionOverviewDto {
  @ApiProperty({ type: [RetentionPolicyDto] })
  policies!: RetentionPolicyDto[];
  @ApiProperty({ type: BackupStatusDto })
  backup!: BackupStatusDto;
}

/**
 * What a purge would be allowed to delete today (M23-21). Read-only: no purge engine is
 * wired, so this reports the PLAN, never a completed deletion.
 */
export class PurgePlanEntryDto {
  @ApiProperty() dataset!: string;
  @ApiProperty({ enum: DataClass }) dataClass!: DataClass;
  @ApiProperty() purgeExempt!: boolean;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Records older than this may be deleted. Null = nothing is eligible.',
  })
  cutoff!: string | null;

  static from(entry: PurgePlanEntry): PurgePlanEntryDto {
    return {
      dataset: entry.dataset,
      dataClass: entry.dataClass,
      purgeExempt: entry.purgeExempt,
      cutoff: entry.cutoff ? entry.cutoff.toISOString() : null,
    };
  }
}
