import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

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
