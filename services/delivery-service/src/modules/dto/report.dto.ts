import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsISO8601, Min } from 'class-validator';

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
}
