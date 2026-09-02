import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { SweepStatus } from '../../application/services/sweep.service';

/** One heartbeat from `scripts/scheduler/sweep.sh` (CA-5-01). */
export class RecordSweepRunDto {
  @ApiProperty({ example: 'orders/outbox/internal/process' })
  @IsString()
  @MaxLength(200)
  job!: string;

  @ApiProperty({ example: 'order:3004' })
  @IsString()
  @MaxLength(100)
  host!: string;

  /**
   * The service's own verdict on the round, NOT HTTP 200. Most sweeps catch per row, so a
   * round in which everything failed still answers 200 with a well-formed body — which is
   * exactly how a dead flow and a quiet one became the same two files on disk.
   */
  @ApiProperty({ example: true })
  @IsBoolean()
  ok!: boolean;

  @ApiPropertyOptional({ description: 'Response tail or the failure line. Free text.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}

export class SweepStatusDto {
  @ApiProperty() job!: string;
  @ApiProperty() label!: string;
  @ApiProperty() everyMinutes!: number;
  @ApiProperty({ enum: ['OK', 'FAILING', 'OVERDUE', 'NEVER_RAN', 'DORMANT'] })
  verdict!: string;
  @ApiProperty({ nullable: true, type: String }) dormantReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastRunAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastOkAt!: string | null;
  @ApiProperty({ nullable: true, type: Boolean }) ok!: boolean | null;
  @ApiProperty({ nullable: true, type: String }) detail!: string | null;
  @ApiProperty() consecutiveFailures!: number;
  @ApiProperty({ nullable: true, type: String }) host!: string | null;
  @ApiProperty() overdueAfterMinutes!: number;

  static from(s: SweepStatus): SweepStatusDto {
    return {
      job: s.job,
      label: s.label,
      everyMinutes: s.everyMinutes,
      verdict: s.verdict,
      dormantReason: s.dormantReason,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastOkAt: s.lastOkAt?.toISOString() ?? null,
      ok: s.ok,
      detail: s.detail,
      consecutiveFailures: s.consecutiveFailures,
      host: s.host,
      overdueAfterMinutes: s.overdueAfterMinutes,
    };
  }
}
