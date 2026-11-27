import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { PROSPECT_LEVELS } from '../../application/ai-read/prospect-metrics';

/** The prospects route: one WIB month (YYYY-MM), a level, and which metric of the prospects group. */
export class ProspectQueryDto {
  @ApiProperty({ example: 'B-02', description: 'A metric of the prospects group (see the contract).' })
  @IsString()
  metric!: string;

  @ApiProperty({
    example: '2026-11',
    description: 'The WIB calendar month, YYYY-MM. B-01 only the running month; B-02 and B-03 a closed month, from day 1 of the next.',
  })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;

  @ApiPropertyOptional({ enum: PROSPECT_LEVELS, default: 'kecamatan' })
  @IsOptional()
  @IsIn(PROSPECT_LEVELS)
  level?: string;
}
