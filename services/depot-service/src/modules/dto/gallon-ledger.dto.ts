import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

/** The AI read API's gallon ledger: depots (at most 100, a real window, `from` not after `to`). */
export class GallonLedgerQueryDto {
  @ApiProperty({ description: 'Comma-separated depot ids, at most 100.' })
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,99}$/i,
  )
  depotIds!: string;

  @ApiProperty({ description: 'Start of the window (inclusive, ISO 8601).' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ description: 'End of the window (exclusive) and the instant the balance is taken at; not before from.' })
  @IsISO8601({ strict: true })
  @IsNotBefore('from')
  @IsWithinDays('from', 367)
  to!: string;
}
