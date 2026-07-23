import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsISO8601, IsUUID, Min } from 'class-validator';

export class SlaReportQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive lower bound on deliveredAt/failedAt (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound on deliveredAt/failedAt (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description: 'On-time threshold in minutes; defaults to DELIVERY_SLA_MINUTES.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  thresholdMinutes?: number;

  @ApiPropertyOptional({
    description: 'Comma-separated depot ids to scope the SLA to (per-franchise). Omit for global.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      : value,
  )
  @IsUUID('4', { each: true })
  depotIds?: string[];
}

export class DepotTeamReportQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot whose team metrics to report.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO 8601); defaults to month start.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound (ISO 8601); defaults to next month.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
