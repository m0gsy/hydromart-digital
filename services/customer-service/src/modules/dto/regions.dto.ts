import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsLatitude, IsLongitude, Matches, ValidateNested } from 'class-validator';

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
