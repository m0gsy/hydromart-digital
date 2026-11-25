import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsOptional,
  IsISO8601, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';
import { INT4_MAX } from '@hydromart/platform';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class GetDepotTargetQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to read the target for.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: '2026-07', description: 'ISO year-month.' })
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  month!: string;
}

export class UpsertDepotTargetDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'CA-2-53: the `updatedAt` this edit started from. The write is refused (409) if the stored row has moved since.',
  })
  @IsOptional()
  @IsISO8601()
  seenUpdatedAt?: string;

  @ApiProperty({ format: 'uuid', description: 'Depot the target belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: '2026-07', description: 'ISO year-month.' })
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  month!: string;

  @ApiProperty({ example: 45_000_000 })
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  revenueTargetIdr!: number;

  @ApiProperty({ example: 1200 })
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  ordersTarget!: number;

  @ApiProperty({ example: 96, description: 'On-time SLA target as a whole percent.' })
  @IsInt()
  @Min(0)
  @Max(100)
  slaTargetPct!: number;

  @ApiProperty({ example: 80 })
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  newCustomersTarget!: number;

  @ApiPropertyOptional({
    example: 3000,
    description: 'Gallons sold in the month: gallon units on delivered or completed orders by order date, counter sales and free promo gallons included (the AI read API metric G-01). 0 = no gallon target. Left out = the stored value is kept.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  gallonsTarget?: number;
}

/** HD-16: the month targets of many depots at once (service-to-service). */
export class DepotTargetsByMonthQueryDto {
  @ApiProperty({ description: 'Comma-separated depot ids (1 to 100).' })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : value,
  )
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  depotIds!: string[];

  @ApiProperty({ example: '2026-11', description: 'ISO year-month.' })
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  month!: string;
}

export class DepotTargetsByMonthResponseDto {
  @ApiProperty({ format: 'uuid' })
  depotId!: string;
  @ApiProperty({ description: 'Revenue goal in IDR. 0 = not set.' })
  revenueTargetIdr!: number;
  @ApiProperty({ description: 'Orders. 0 = not set.' })
  ordersTarget!: number;
  @ApiProperty({ description: 'People. 0 = not set.' })
  newCustomersTarget!: number;
  @ApiProperty({ description: 'Gallons sold (metric G-01). 0 = not set.' })
  gallonsTarget!: number;
}
