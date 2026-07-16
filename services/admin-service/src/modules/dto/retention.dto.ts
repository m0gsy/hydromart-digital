import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  BackupStatusRecord,
  RetentionPolicyRecord,
} from '../../application/ports/retention.repository';

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
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  static from(record: RetentionPolicyRecord): RetentionPolicyDto {
    return {
      id: record.id,
      dataset: record.dataset,
      windowLabel: record.windowLabel,
      windowDays: record.windowDays,
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

/** Read-only backup status — labeled honestly ("NONE" = no backup engine has run). */
export class BackupStatusDto {
  @ApiProperty({ example: 'NONE', description: '"NONE" = no backup engine wired/has run.' })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastBackupAt!: string | null;

  static from(record: BackupStatusRecord): BackupStatusDto {
    return {
      status: record.status,
      lastBackupAt: record.lastBackupAt ? record.lastBackupAt.toISOString() : null,
    };
  }
}

export class RetentionOverviewDto {
  @ApiProperty({ type: [RetentionPolicyDto] })
  policies!: RetentionPolicyDto[];
  @ApiProperty({ type: BackupStatusDto })
  backup!: BackupStatusDto;
}
