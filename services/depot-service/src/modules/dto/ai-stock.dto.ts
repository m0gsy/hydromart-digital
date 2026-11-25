import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** HD-6 H4: the depots an AI read asks about. At most 100, so a call stays one bounded read. */
export class AiStockDepotsQueryDto {
  @ApiProperty({ description: 'Comma-separated depot ids, at most 100.' })
  @Matches(new RegExp(`^${UUID}(,${UUID}){0,99}$`, 'i'))
  depotIds!: string;
}

/** The same, over a window of instants `[from, to)`. */
export class AiStockWindowQueryDto extends AiStockDepotsQueryDto {
  @ApiProperty({ example: '2026-10-31T17:00:00.000Z' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: 'Exclusive; not before `from`, at most a leap year later.' })
  @IsISO8601()
  @IsNotBefore('from')
  @IsWithinDays('from')
  to!: string;
}
