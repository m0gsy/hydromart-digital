import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { PeriodQueryDto } from './ai-read.dto';

/** The stock route: a period, and which metric of the stock group. An id outside it is a 404, not a 400. */
export class StockQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'S-01', description: 'A metric of the stock group (see the contract).' })
  @IsString()
  metric!: string;
}

/** The loyalty, promo, subscription and queue route: same shape, its own group. */
export class LoyaltyQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'O-04', description: 'A metric of the loyalty, promo and queue group (see the contract).' })
  @IsString()
  metric!: string;
}
