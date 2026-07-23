import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export class ExecutiveQueryDto {
  @ApiPropertyOptional({ description: 'Range start (ISO 8601), forwarded to reports.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Range end (ISO 8601), forwarded to reports.' })
  @IsOptional()
  @IsISO8601()
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
