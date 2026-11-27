import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { INT4_MAX } from '@hydromart/platform';

import {
  B2B_CATEGORIES,
  B2B_STATUSES,
  B2bCategory,
  B2bDncReason,
  B2bProspectStatus,
  B2bSource,
  DNC_REASONS,
  IMPORT_MAX_ROWS,
} from '../../domain/b2b-prospect';

/** A blank spreadsheet cell arrives as '' or whitespace: that is "not given", never a value. */
const Blank = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

/** A pin half from a sheet: a number, a numeric string, or nothing. Anything else is NaN (the row fails, not the file). */
const Coord = () =>
  Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)));

/**
 * One row of an AREA-T candidate file, keyed by the shared column list (`IMPORT_COLUMNS`). Every
 * field is optional here on purpose: a row that cannot be read fails ITSELF with a message the
 * wizard shows, it does not 400 the other 499. The server recomputes region codes, grid cell and
 * owner depot, so those columns (and the informational ones) are accepted and ignored.
 */
export class ImportProspectRowDto {
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional({ enum: B2B_CATEGORIES, description: 'AREA-T category id, any case (tempat_ibadah).' })
  @Blank() @IsOptional() @IsString() @MaxLength(40) category?: string;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional({ example: -6.2 }) @Coord() @IsOptional() @IsNumber({ allowNaN: true }) lat?: number;
  @ApiPropertyOptional({ example: 106.8 }) @Coord() @IsOptional() @IsNumber({ allowNaN: true }) lng?: number;
  // Recomputed by the server; accepted so the whole candidate file can be posted unchanged.
  @Allow() kecamatanCode?: unknown;
  @Allow() kelurahanCode?: unknown;
  @Allow() gridCell?: unknown;
  @Allow() ownerDepotCode?: unknown;
  @Allow() distanceKm?: unknown;
  @ApiPropertyOptional({ description: 'overture | osm | foursquare_os | internal' })
  @Blank() @IsOptional() @IsString() @MaxLength(40) source?: string;
  @ApiPropertyOptional({ description: 'Licence ids joined with ";" (e.g. CDLA-Permissive-2.0;ODbL-1.0).' })
  @Blank() @IsOptional() @IsString() @MaxLength(200) license?: string;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(200) sourceId?: string;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(80) sourceDataset?: string;
  @ApiPropertyOptional({ example: '2026-11-01' }) @Blank() @IsOptional() @IsString() @MaxLength(30) sourceUpdated?: string;
  @Allow() fetchedDate?: unknown;
  @Allow() categoryConfidence?: unknown;
  @Allow() alsoIn?: unknown;
}

export class ImportProspectsDto {
  @ApiProperty({ description: 'true = judge every row, write nothing (the same verdicts a commit would give).' })
  @IsBoolean()
  dryRun!: boolean;

  @ApiPropertyOptional({ minimum: 0, description: 'Third-party cost of this file in IDR (v1: always 0).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  costIdr?: number;

  @ApiProperty({ type: [ImportProspectRowDto], description: `Max ${IMPORT_MAX_ROWS} rows per file.` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => ImportProspectRowDto)
  rows!: ImportProspectRowDto[];
}

/** A business found in the field (POST /b2b-prospects). The source is forced to FIELD by the server. */
export class CreateProspectDto {
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiProperty({ enum: B2B_CATEGORIES }) @IsIn(B2B_CATEGORIES as readonly string[]) category!: B2bCategory;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiProperty({ example: -6.2 }) @IsNumber({ allowNaN: false, allowInfinity: false }) @IsLatitude() latitude!: number;
  @ApiProperty({ example: 106.8 }) @IsNumber({ allowNaN: false, allowInfinity: false }) @IsLongitude() longitude!: number;
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ProspectListQueryDto {
  @ApiPropertyOptional({ enum: ['work', 'map'], default: 'work', description: 'map = no owner depot; network roles only.' })
  @IsOptional() @IsIn(['work', 'map']) scope?: 'work' | 'map';
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() depotId?: string;
  @ApiPropertyOptional({ enum: B2B_STATUSES }) @IsOptional() @IsIn(B2B_STATUSES as readonly string[]) status?: B2bProspectStatus;
  @ApiPropertyOptional({ enum: B2B_CATEGORIES }) @IsOptional() @IsIn(B2B_CATEGORIES as readonly string[]) category?: B2bCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) kecamatanCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) kelurahanCode?: string;
  @ApiPropertyOptional({ description: 'me | none | <staff uuid>' })
  @ValidateIf((o: ProspectListQueryDto) => o.assigned !== undefined && o.assigned !== 'me' && o.assigned !== 'none')
  @IsUUID()
  assigned?: string;
  @ApiPropertyOptional({ description: 'Matches the business name only.' })
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/** The same filters minus the depot ones: /mine is the caller's own list. */
export class MineQueryDto {
  @ApiPropertyOptional({ enum: B2B_STATUSES }) @IsOptional() @IsIn(B2B_STATUSES as readonly string[]) status?: B2bProspectStatus;
  @ApiPropertyOptional({ enum: B2B_CATEGORIES }) @IsOptional() @IsIn(B2B_CATEGORIES as readonly string[]) category?: B2bCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) kecamatanCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) kelurahanCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) q?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CoverageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() depotId?: string;
}

export class AssigneesQueryDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() depotId!: string;
}

/** Name only: there is deliberately no phone field on this class. */
export class AssigneeResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class SetProspectStatusDto {
  @ApiProperty({ enum: B2B_STATUSES }) @IsIn(B2B_STATUSES as readonly string[]) status!: B2bProspectStatus;
  @ApiPropertyOptional({ description: 'Required for LOST (3 to 200 characters).' })
  @IsOptional() @IsString() @MaxLength(200) lostReason?: string;
  @ApiProperty({ description: 'The updatedAt the caller read; a newer row is a 409.' })
  @IsISO8601() seenUpdatedAt!: string;
}

export class AssignProspectDto {
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Staff account id, or null to unassign.' })
  @ValidateIf((o: AssignProspectDto) => o.assigneeId !== null)
  @IsUUID()
  assigneeId!: string | null;
  @ApiPropertyOptional({ description: 'The updatedAt the caller read; a newer row is a 409.' })
  @IsOptional() @IsISO8601() seenUpdatedAt?: string;
}

export class SetOwnerDepotDto {
  @ApiProperty({ format: 'uuid', nullable: true, description: 'An active depot, or null for the opportunity map.' })
  @ValidateIf((o: SetOwnerDepotDto) => o.depotId !== null)
  @IsUUID()
  depotId!: string | null;
  @ApiProperty({ minLength: 3, maxLength: 200 }) @IsString() @MinLength(3) @MaxLength(200) reason!: string;
  @ApiPropertyOptional({ description: 'The updatedAt the caller read; a newer row is a 409.' })
  @IsOptional() @IsISO8601() seenUpdatedAt?: string;
}

export class SuppressDto {
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional({ description: 'With latitude and longitude when there is no phone.' })
  @Blank() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @IsLongitude() longitude?: number;
  @ApiProperty({ enum: DNC_REASONS }) @IsIn(DNC_REASONS as readonly string[]) reason!: B2bDncReason;
}

export class SuppressProspectDto {
  @ApiProperty({ enum: DNC_REASONS }) @IsIn(DNC_REASONS as readonly string[]) reason!: B2bDncReason;
}

/** Counts only: there is deliberately no name, phone or address field on this class. */
export class CoverageCategoryDto {
  @ApiProperty({ enum: B2B_CATEGORIES }) category!: B2bCategory;
  @ApiProperty() total!: number;
  @ApiProperty() withPhone!: number;
  @ApiProperty({ description: 'Percent 0..100, one decimal; 0 when there are no rows.' }) withPhonePct!: number;
}

export class CoverageResponseDto {
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Prospects with no owner depot (the opportunity map).' }) onMap!: number;
  @ApiProperty({ type: [CoverageCategoryDto] }) byCategory!: CoverageCategoryDto[];
  @ApiProperty() byStatus!: { status: B2bProspectStatus; total: number }[];
  @ApiProperty() bySource!: { source: B2bSource; total: number }[];
  @ApiProperty({ nullable: true }) dataAge!: { newestDays: number; medianDays: number; oldestDays: number } | null;
  @ApiProperty({ nullable: true, description: 'Network roles only; null for a depot role.' })
  thirdPartyCostIdr!: number | null;
}

/** A list row: the business, never a person (no phone, contact name or note). */
export class ProspectRowResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: B2B_CATEGORIES }) category!: B2bCategory;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
  @ApiProperty({ nullable: true }) kecamatanCode!: string | null;
  @ApiProperty({ nullable: true }) kelurahanCode!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Null = the opportunity map.' }) ownerDepotId!: string | null;
  @ApiProperty({ enum: ['AUTO', 'HQ'] }) ownerSource!: 'AUTO' | 'HQ';
  @ApiProperty({ enum: B2B_STATUSES }) status!: B2bProspectStatus;
  @ApiProperty({ format: 'uuid', nullable: true }) assignedToId!: string | null;
  @ApiProperty({ enum: ['OVERTURE', 'OSM', 'FOURSQUARE_OS', 'INTERNAL', 'FIELD'] }) source!: B2bSource;
  @ApiProperty({ nullable: true }) sourceDate!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ description: 'The version a status change must echo back as seenUpdatedAt.' }) updatedAt!: Date;
  @ApiProperty() hasPhone!: boolean;
}

/** One prospect opened by a Work holder: adds the person-level fields. */
export class ProspectDetailResponseDto extends ProspectRowResponseDto {
  @ApiProperty({ nullable: true }) phoneE164!: string | null;
  @ApiProperty({ nullable: true }) contactName!: string | null;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty({ nullable: true }) licence!: string | null;
  @ApiProperty({ nullable: true }) sourceId!: string | null;
  @ApiProperty({ nullable: true }) sourceDataset!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) customerId!: string | null;
  @ApiProperty({ nullable: true }) convertedAt!: Date | null;
  @ApiProperty({ nullable: true }) lostReason!: string | null;
  @ApiProperty({ nullable: true }) assignedAt!: Date | null;
  @ApiProperty() lastActivityAt!: Date;
}

export class ProspectOpenedResponseDto extends ProspectDetailResponseDto {
  @ApiProperty({ description: 'The latest 20 check-ins.', type: 'array', items: { type: 'object' } })
  visits!: Record<string, unknown>[];
}

export class ProspectListPageResponseDto {
  @ApiProperty({ type: [ProspectRowResponseDto] }) items!: ProspectRowResponseDto[];
  @ApiProperty({ nullable: true, description: 'Pass as `cursor` for the next page.' }) nextCursor!: string | null;
}

export class ProspectMinePageResponseDto {
  @ApiProperty({ type: [ProspectDetailResponseDto] }) items!: ProspectDetailResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}

export class ImportProspectsResponseDto {
  @ApiProperty() dryRun!: boolean;
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty({ description: 'Refused rows (licence, do-not-contact, already a customer, duplicate).' }) skipped!: number;
  @ApiProperty({ description: 'Rows that could not be read or judged (no pin, bad category, auth or depot service down).' })
  failed!: number;
  @ApiProperty({ description: 'Refusals by reason.' }) reasons!: Record<string, number>;
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: 'Per row: row, status, reason?, message?, id?' })
  results!: Record<string, unknown>[];
}

export class SuppressResultResponseDto {
  @ApiProperty({ description: 'Do-not-contact entries now on the list for this request.' }) entries!: number;
  @ApiProperty({ description: 'Live prospects that matched and were wiped.' }) prospects!: number;
}

export const VISIT_OUTCOMES = ['MET_DECISION_MAKER', 'LEFT_MATERIAL', 'NOT_THERE', 'REFUSED'] as const;

/** A GPS check-in at the prospect. `accuracyM` is required: a fix with no stated accuracy proves nothing. */
export class VisitProspectDto {
  @ApiProperty({ example: -6.2 }) @IsNumber({ allowNaN: false, allowInfinity: false }) @IsLatitude() latitude!: number;
  @ApiProperty({ example: 106.8 }) @IsNumber({ allowNaN: false, allowInfinity: false }) @IsLongitude() longitude!: number;
  @ApiProperty({ minimum: 0, description: 'The phone-reported accuracy of the fix, metres.' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(INT4_MAX)
  accuracyM!: number;
  @ApiProperty({ enum: VISIT_OUTCOMES }) @IsIn(VISIT_OUTCOMES as readonly string[]) outcome!: (typeof VISIT_OUTCOMES)[number];
  @ApiPropertyOptional() @Blank() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ConvertProspectDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'An existing customer account. Needed when the prospect has no mobile number.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class ExportProspectsDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() depotId?: string;
  @ApiPropertyOptional({ enum: B2B_STATUSES }) @IsOptional() @IsIn(B2B_STATUSES as readonly string[]) status?: B2bProspectStatus;
  @ApiPropertyOptional({ enum: B2B_CATEGORIES }) @IsOptional() @IsIn(B2B_CATEGORIES as readonly string[]) category?: B2bCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) kecamatanCode?: string;
  @ApiPropertyOptional({ description: 'me | none | <staff uuid>' })
  @ValidateIf((o: ExportProspectsDto) => o.assigned !== undefined && o.assigned !== 'me' && o.assigned !== 'none')
  @IsUUID()
  assigned?: string;
}

/** The sweep's call (admin-service, internal key): everything idle since this instant goes. */
export class PurgeProspectsDto {
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() cutoff!: string;
}

export class PurgeProspectsResponseDto {
  @ApiProperty({ description: 'Rows deleted: the field the purge executors read.' }) deleted!: number;
  @ApiProperty({ description: 'Converted rows stripped of everything that names or places the business (kept for counts).' })
  anonymised!: number;
}

export class RecomputeOwnersResponseDto {
  @ApiProperty() checked!: number;
  @ApiProperty() changed!: number;
  @ApiProperty({ description: 'Of the changed, how many now have no owner depot (the opportunity map).' }) nowOnMap!: number;
}

export class VisitResponseDto {
  @ApiProperty({ type: ProspectDetailResponseDto }) prospect!: ProspectDetailResponseDto;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The check-in just recorded (id, distanceM, outcome...).' }) visit!: Record<string, unknown>;
}

export class ExportResponseDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: 'Cells that start with = + - @ are prefixed with an apostrophe (except phone).' })
  rows!: Record<string, unknown>[];
  @ApiProperty({ description: 'More rows matched than the cap; narrow the filter.' }) truncated!: boolean;
  @ApiProperty() rowCount!: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Visits of the exported rows (rowIndex into rows, visitorId, visitedAt, outcome, distanceM): no pin, no note.',
  })
  visits!: Record<string, unknown>[];
}
