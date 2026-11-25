import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

/** A window of instants `[from, to)`: real calendar instants, from before to, at most a leap year. */
export class AiReferralWindowDto {
  @ApiProperty({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ description: 'Exclusive upper bound (ISO 8601), not before from, at most a leap year later.' })
  @IsISO8601({ strict: true })
  @IsNotBefore('from')
  @IsWithinDays('from', 367)
  to!: string;
}
