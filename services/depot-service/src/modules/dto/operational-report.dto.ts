import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID } from 'class-validator';

export class OperationalCostQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to report on.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ description: 'Inclusive range start (ISO 8601).' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: 'Exclusive range end (ISO 8601).' })
  @IsISO8601()
  to!: string;
}
