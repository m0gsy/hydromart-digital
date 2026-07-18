import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CommissionQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Depot to run commission for.' })
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
