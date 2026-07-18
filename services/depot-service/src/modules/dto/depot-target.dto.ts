import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

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
  @ApiProperty({ format: 'uuid', description: 'Depot the target belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: '2026-07', description: 'ISO year-month.' })
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  month!: string;

  @ApiProperty({ example: 45_000_000 })
  @IsInt()
  @Min(0)
  revenueTargetIdr!: number;

  @ApiProperty({ example: 1200 })
  @IsInt()
  @Min(0)
  ordersTarget!: number;

  @ApiProperty({ example: 96, description: 'On-time SLA target as a whole percent.' })
  @IsInt()
  @Min(0)
  @Max(100)
  slaTargetPct!: number;

  @ApiProperty({ example: 80 })
  @IsInt()
  @Min(0)
  newCustomersTarget!: number;
}
