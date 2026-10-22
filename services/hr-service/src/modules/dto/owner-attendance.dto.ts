import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

import { AttendanceResponseDto } from './responses.generated.dto';

/** The summary needs a window: a count without one would be "since forever", which nobody asked for. */
export class OwnerSummaryQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsISO8601() from!: string;
  @IsISO8601() @IsNotBefore('from') @IsWithinDays('from') to!: string;
}

export class OwnerDepotResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null when depot-service could not name it.' })
  name!: string | null;
}

export class OwnerAttendancePageResponseDto {
  @ApiProperty({ type: [AttendanceResponseDto] }) rows!: AttendanceResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class OwnerDepotSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) depotId!: string;
  @ApiProperty({ type: String, nullable: true }) depotName!: string | null;
  @ApiProperty() present!: number;
  @ApiProperty() late!: number;
  @ApiProperty() absent!: number;
  @ApiProperty() leave!: number;
  @ApiProperty() holiday!: number;
  @ApiProperty({ description: 'Offline punches still waiting for HR; they count as nothing yet.' })
  pending!: number;
  @ApiProperty({ description: 'Minutes late, summed over the LATE days.' }) lateMinutes!: number;
  @ApiProperty({ description: 'Distinct people with at least one row in the window.' }) employees!: number;
}

export class OwnerAttendanceSummaryResponseDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: [OwnerDepotSummaryResponseDto] })
  @Type(() => OwnerDepotSummaryResponseDto)
  depots!: OwnerDepotSummaryResponseDto[];
}
