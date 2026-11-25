import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsUUID, ValidateNested } from 'class-validator';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

/** One depot and the instants `[from, to)` it may be read in. Real calendar instants, from before to. */
export class AiDiscountSpanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ description: 'Exclusive upper bound (ISO 8601), not before from, at most a leap year later.' })
  @IsISO8601({ strict: true })
  @IsNotBefore('from')
  @IsWithinDays('from', 367)
  to!: string;
}

export class AiDiscountsDto {
  @ApiProperty({ type: [AiDiscountSpanDto], description: 'At most 200 spans over at most 100 depots.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AiDiscountSpanDto)
  spans!: AiDiscountSpanDto[];
}

/** A window of instants `[from, to)`, real calendar instants, from before to, at most a leap year. */
export class AiSubscriptionWindowDto {
  @ApiProperty({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ description: 'Exclusive upper bound (ISO 8601), not before from, at most a leap year later.' })
  @IsISO8601({ strict: true })
  @IsNotBefore('from')
  @IsWithinDays('from', 367)
  to!: string;
}
