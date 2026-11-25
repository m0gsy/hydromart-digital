import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsUUID, Matches, ValidateNested } from 'class-validator';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

/** At most 100 comma-separated uuids. */
const UUID_LIST =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,99}$/i;

/** One depot and the instants `[from, to)` it may be read in. Real calendar instants, from before to. */
export class AiSpanDto {
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

export class AiSpansDto {
  @ApiProperty({ type: [AiSpanDto], description: 'At most 200 spans over at most 100 depots.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AiSpanDto)
  spans!: AiSpanDto[];
}

export class AiCustomerMetricsDto extends AiSpansDto {
  @ApiProperty({ description: 'Start of the whole period: "repeat" means an order before this instant.' })
  @IsISO8601({ strict: true })
  periodFrom!: string;
}

export class AiSegmentsDto {
  @ApiProperty({ description: 'Comma-separated depot ids, at most 100.' })
  @Matches(UUID_LIST)
  depotIds!: string;

  @ApiProperty() @IsISO8601({ strict: true }) riskSince!: string;
  @ApiProperty() @IsISO8601({ strict: true }) @IsNotBefore('riskSince') @IsWithinDays('riskSince', 70) activeSince!: string;
  @ApiProperty() @IsISO8601({ strict: true }) @IsNotBefore('activeSince') @IsWithinDays('riskSince', 70) until!: string;
}

export class AiLiveOrdersQueryDto {
  @ApiProperty({ description: 'Comma-separated depot ids, at most 100.' })
  @Matches(UUID_LIST)
  depotIds!: string;
}
