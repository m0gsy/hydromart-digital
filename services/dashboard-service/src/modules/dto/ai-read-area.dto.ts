import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { AREA_LEVELS } from '../../application/ai-read/area-metrics';

/** The areas route: one whole closed month (YYYY-MM), a level, and which metric of the areas group. */
export class AreaQueryDto {
  @ApiProperty({ example: 'R-01', description: 'A metric of the areas group (see the contract).' })
  @IsString()
  metric!: string;

  @ApiProperty({ example: '2026-11', description: 'The WIB calendar month, YYYY-MM; only a closed month, from the 8th of the next month.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;

  @ApiPropertyOptional({ enum: AREA_LEVELS, default: 'kecamatan' })
  @IsOptional()
  @IsIn(AREA_LEVELS)
  level?: string;
}
