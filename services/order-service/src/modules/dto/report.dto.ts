import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsISO8601, Max, Min } from 'class-validator';

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
