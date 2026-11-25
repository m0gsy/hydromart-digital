import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { PeriodQueryDto } from './ai-read.dto';

/** The customer route: a period, and which metric of the customer group. An id outside it is a 404, not a 400. */
export class CustomerQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'C-01', description: 'A metric of the customer group (see the contract).' })
  @IsString()
  metric!: string;
}

/** The delivery route: same shape, its own group. */
export class DeliveryQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'K-01', description: 'A metric of the delivery group (see the contract).' })
  @IsString()
  metric!: string;
}

/** The gallon route: same shape, its own group. */
export class GallonQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'G-01', description: 'A metric of the gallon group (see the contract).' })
  @IsString()
  metric!: string;
}
