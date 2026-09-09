import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

import { SlaPolicyRecord } from '../../application/ports/sla-policy.repository';

/* ---------- Requests ---------- */

export class SaveSlaPolicyDto {
  @ApiProperty({
    example: 90,
    minimum: 10,
    maximum: 480,
    description: 'On-time threshold (minutes).',
  })
  @IsInt()
  @Min(10)
  @Max(480)
  onTimeThresholdMinutes!: number;

  @ApiProperty({
    example: 95,
    minimum: 0,
    maximum: 100,
    description: '% on-time at/above which a depot is healthy.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  healthyBandPct!: number;

  @ApiProperty({
    example: 85,
    minimum: 0,
    maximum: 100,
    description: '% on-time below which a depot is critical.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  criticalBandPct!: number;

  @ApiPropertyOptional({
    description:
      'The `updatedAt` this edit started from. The write is refused (409) if the stored row has moved since.',
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601()
  seenUpdatedAt?: string;
}

/* ---------- Responses ---------- */

export class SlaPolicyDto {
  @ApiProperty({ example: 90 })
  onTimeThresholdMinutes!: number;
  @ApiProperty({ example: 95 })
  healthyBandPct!: number;
  @ApiProperty({ example: 85 })
  criticalBandPct!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: SlaPolicyRecord): SlaPolicyDto {
    return {
      onTimeThresholdMinutes: record.onTimeThresholdMinutes,
      healthyBandPct: record.healthyBandPct,
      criticalBandPct: record.criticalBandPct,
      updatedAt: record.updatedAt,
    };
  }
}
