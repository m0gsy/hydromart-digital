import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { PeriodQueryDto } from './ai-read.dto';

/** The visits route (AI-21): a period, and which metric of the visits group. An id outside it is a 404, not a 400. */
export class VisitQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'V-01', description: 'A metric of the visits group (see the contract).' })
  @IsString()
  metric!: string;
}
