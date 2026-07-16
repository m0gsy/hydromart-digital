import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsISO8601, IsUUID, Max, Min } from 'class-validator';

export class SalesReportQueryDto {
  @ApiPropertyOptional({ enum: ['daily', 'monthly'], default: 'daily' })
  @IsOptional()
  @IsIn(['daily', 'monthly'])
  granularity?: 'daily' | 'monthly';

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class RangeReportQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class AudienceReachQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Scope the count to one depot.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

export class SegmentEstimateQueryDto {
  @ApiPropertyOptional({ minimum: 1, description: 'Last order within this many days (recency).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recencyDays?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'At least this many non-cancelled orders (frequency).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minOrders?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customers who ordered at this depot.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

export class TopReportQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
