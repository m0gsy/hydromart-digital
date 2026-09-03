import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

export class ExecutiveQueryDto {
  /**
   * One depot to report on. Named `depotId` deliberately: that is the key DepotScopeGuard
   * reads, so asking for a depot outside the caller's scope is refused before the handler
   * runs. Omitted, a depot-scoped caller still gets only their own depots.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'Scope the dashboard to one depot.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ description: 'Range start (ISO 8601), forwarded to reports.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Range end (ISO 8601), forwarded to reports.' })
  @IsOptional()
  @IsISO8601()
  @IsNotBefore('from')
  @IsWithinDays('from')
  to?: string;
}

export class MonthlyPnlQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to report on.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ description: 'Reported month, YYYY-MM.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be a valid YYYY-MM' })
  month!: string;
}
