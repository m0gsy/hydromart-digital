import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { INT4_MAX } from '@hydromart/platform';

import { FollowUpStatus, VisitItemResult, VisitStatus } from '../../domain/visit';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** A WIB calendar day, `YYYY-MM-DD`, that really exists (2026-02-31 is refused). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class StartVisitDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ format: 'uuid', description: 'The visit template (checklist) to work through.' })
  @IsUUID()
  templateId!: string;

  @ApiProperty({ example: -6.2 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 106.8 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({ description: "The phone's accuracy for that fix, in metres (required: the \"Perkiraan\" rule needs it)." })
  @IsNumber()
  @Min(0)
  @Max(INT4_MAX)
  accuracyM!: number;
}

export class AnswerVisitItemDto {
  @ApiProperty({ enum: [VisitItemResult.PASS, VisitItemResult.FINDING] })
  @IsIn([VisitItemResult.PASS, VisitItemResult.FINDING])
  result!: VisitItemResult.PASS | VisitItemResult.FINDING;

  @ApiPropertyOptional({ description: 'Required for a FINDING.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  findingNote?: string;

  @ApiPropertyOptional({ description: 'Key returned by POST /visits/:id/uploads. Required for a FINDING.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  photoKey?: string;

  @ApiPropertyOptional({ example: '2026-12-05', description: 'WIB day, today to +90 days. Required for a FINDING.' })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  followUpDueOn?: string;
}

export class CloseFollowUpDto {
  @ApiPropertyOptional({ description: 'What was done.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class PageDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export class ListVisitsQueryDto extends PageDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ enum: VisitStatus })
  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;
}

export class ListFindingsQueryDto extends PageDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ enum: ['open', 'overdue', 'done'] })
  @IsOptional()
  @IsIn(['open', 'overdue', 'done'])
  state?: 'open' | 'overdue' | 'done';
}

// Response shapes, declared so the OpenAPI document says what the routes return (audit D-6).
export class VisitItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() visitId!: string;
  @ApiProperty() depotId!: string;
  @ApiProperty() position!: number;
  @ApiProperty() text!: string;
  @ApiProperty({ nullable: true }) sopId!: string | null;
  @ApiProperty({ nullable: true }) sopVersionId!: string | null;
  @ApiProperty({ nullable: true }) sopVersionNo!: number | null;
  @ApiProperty({ nullable: true }) sopTitle!: string | null;
  @ApiProperty({ enum: VisitItemResult }) result!: VisitItemResult;
  @ApiProperty({ nullable: true }) findingNote!: string | null;
  @ApiProperty({ nullable: true, description: 'A link that expires in minutes; null without a photo.' })
  photoUrl!: string | null;
  @ApiProperty({ nullable: true, description: 'WIB day, YYYY-MM-DD.' }) followUpDueOn!: string | null;
  @ApiProperty({ enum: FollowUpStatus, nullable: true }) followUpStatus!: FollowUpStatus | null;
  @ApiProperty({ nullable: true }) followUpDoneAt!: Date | null;
  @ApiProperty({ nullable: true }) followUpNote!: string | null;
}

export class VisitResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() depotId!: string;
  @ApiProperty({ nullable: true }) templateId!: string | null;
  @ApiProperty() templateName!: string;
  @ApiProperty() visitorId!: string;
  @ApiProperty({ enum: VisitStatus }) status!: VisitStatus;
  @ApiProperty() checkInAt!: Date;
  @ApiProperty({ nullable: true }) checkInDistanceM!: number | null;
  @ApiProperty() approximateFix!: boolean;
  @ApiProperty() fenceChecked!: boolean;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty({ type: [VisitItemResponseDto] }) items!: VisitItemResponseDto[];
}

export class VisitSummaryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() depotId!: string;
  @ApiProperty() templateName!: string;
  @ApiProperty() visitorId!: string;
  @ApiProperty({ enum: VisitStatus }) status!: VisitStatus;
  @ApiProperty() checkInAt!: Date;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty() itemCount!: number;
  @ApiProperty() findingCount!: number;
}

export class VisitPageResponseDto {
  @ApiProperty({ type: [VisitSummaryResponseDto] }) items!: VisitSummaryResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class FindingPageResponseDto {
  @ApiProperty({ type: [VisitItemResponseDto] }) items!: VisitItemResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class DepotOverviewResponseDto {
  @ApiProperty() depotId!: string;
  @ApiProperty() depotName!: string;
  @ApiProperty({ nullable: true }) lastVisitAt!: Date | null;
  @ApiProperty() visitsLast30d!: number;
  @ApiProperty({ description: 'Visits of the last 30 days made with the fence off (radius 0).' })
  unfencedVisitsLast30d!: number;
  @ApiProperty() openFindings!: number;
  @ApiProperty() overdueFollowUps!: number;
}

export class VisitOverviewResponseDto {
  @ApiProperty({ type: [DepotOverviewResponseDto] }) depots!: DepotOverviewResponseDto[];
  @ApiProperty({ description: 'More depots are in scope than the 200 listed.' }) truncated!: boolean;
}

export class VisitPhotoUploadResponseDto {
  @ApiProperty({ description: 'visits/<visitId>/<uuid>.<ext>; send it back as photoKey.' }) key!: string;
}

export class OverdueSweepResponseDto {
  @ApiProperty() depots!: number;
  @ApiProperty() items!: number;
  @ApiProperty({ description: 'Depot reminders crm accepted this run (0 while VISIT_NOTIFY_ENABLED is off).' })
  notified!: number;
}
