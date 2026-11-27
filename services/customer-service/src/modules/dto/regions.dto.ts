import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsLatitude, IsLongitude, IsUUID, Matches, ValidateIf, ValidateNested } from 'class-validator';

/** HD-20c: most pins one lookup call carries; the caller chunks. */
export const MAX_LOOKUP_POINTS = 1000;

export class LookupPointDto {
  @ApiProperty() @IsLatitude() lat!: number;
  @ApiProperty() @IsLongitude() lng!: number;
}

export class RegionLookupDto {
  @ApiProperty({ type: [LookupPointDto], description: `At most ${MAX_LOOKUP_POINTS} pins.` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOOKUP_POINTS)
  @ValidateNested({ each: true })
  @Type(() => LookupPointDto)
  points!: LookupPointDto[];
}

export class UnservedDemandQueryDto {
  @ApiProperty({ example: '2026-11', description: 'WIB month, YYYY-MM.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

/** AREA-3: most depots one prospect-aggregates call carries (dashboard-service's MAX_READ_DEPOTS). */
export const MAX_AGGREGATE_DEPOTS = 100;
/** Most cells one answer carries; above it the reply is `tooMany` and no cells. */
export const MAX_AGGREGATE_CELLS = 5000;
export const PROSPECT_AGG_KINDS = ['stock', 'conversions', 'visits'] as const;
export const PROSPECT_AGG_LEVELS = ['depot', 'kecamatan', 'kelurahan', 'grid'] as const;

export class ProspectAggregatesDto {
  @ApiProperty({ enum: PROSPECT_AGG_KINDS }) @IsIn(PROSPECT_AGG_KINDS) kind!: (typeof PROSPECT_AGG_KINDS)[number];
  @ApiProperty({ enum: PROSPECT_AGG_LEVELS }) @IsIn(PROSPECT_AGG_LEVELS) level!: (typeof PROSPECT_AGG_LEVELS)[number];
  @ApiProperty({ example: '2026-11', description: 'WIB month, YYYY-MM (ignored for kind=stock).' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;

  @ApiProperty({ type: [String], nullable: true, description: 'Owner depots to count; null = every depot.' })
  @ValidateIf((o: ProspectAggregatesDto) => o.depotIds !== null)
  @IsArray()
  @ArrayMaxSize(MAX_AGGREGATE_DEPOTS)
  @IsUUID('all', { each: true })
  depotIds!: string[] | null;

  @ApiProperty({ description: 'Adds the prospects no depot serves (owner depot null).' }) @IsBoolean() opportunity!: boolean;
}
