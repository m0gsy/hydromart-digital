import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

import { FlagState } from '../../domain/flag-state';
import { FeatureFlagRecord } from '../../application/ports/feature-flag.repository';

/* ---------- Requests ---------- */

export class UpdateFeatureFlagDto {
  @ApiPropertyOptional({ enum: FlagState, description: 'New lifecycle state for the flag.' })
  @IsOptional()
  @IsEnum(FlagState)
  state?: FlagState;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    nullable: true,
    description: 'Rollout percentage (0..100) for a ROLLOUT flag; null clears the ramp.',
  })
  @IsOptional()
  // Allow an explicit null (clear the ramp) but validate a supplied number.
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPct?: number | null;
}

/* ---------- Responses ---------- */

/** One enforced flag as the public read route and the web see it. */
export class PublicFeatureFlagDto {
  @ApiProperty({ example: 'payments.cash_on_delivery' })
  key!: string;
  @ApiProperty({ description: 'false only when the flag state is OFF.' })
  enabled!: boolean;
}

export class FeatureFlagDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'payments.cash_on_delivery' })
  key!: string;
  @ApiProperty({ example: 'Cash on delivery' })
  label!: string;
  @ApiProperty({ example: 'COD at delivery time' })
  description!: string;
  @ApiProperty({ enum: FlagState })
  state!: FlagState;
  @ApiProperty({ nullable: true, example: 50 })
  rolloutPct!: number | null;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: FeatureFlagRecord): FeatureFlagDto {
    return {
      id: record.id,
      key: record.key,
      label: record.label,
      description: record.description,
      state: record.state,
      rolloutPct: record.rolloutPct,
      updatedAt: record.updatedAt,
    };
  }
}
