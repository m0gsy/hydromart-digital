import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { LEGAL_ENTITY_KINDS, LegalEntityKind } from '../../domain/legal-entity';

/** Outer spaces never count towards the length rules: "  " is not a name. */
const trimmed = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** A role key as the access package spells them: a built-in (`HEAD_OFFICE`) or a custom `C_...`. */
const ROLE_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

export class CreateLegalEntityDto {
  @ApiProperty({ example: 'PT Contoh Air Nusantara', description: 'The registered name.' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: LEGAL_ENTITY_KINDS })
  @IsIn(LEGAL_ENTITY_KINDS)
  kind!: LegalEntityKind;
}

/**
 * Absent = unchanged; an explicit null is refused. `@IsOptional` would let null through every rule
 * below, into a required column (a 500) or past the freshness check as a toggle.
 */
const present = ValidateIf((_: object, value: unknown) => value !== undefined);

export class UpdateLegalEntityDto {
  @ApiPropertyOptional({ example: 'PT Contoh Air Nusantara' })
  @present
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: LEGAL_ENTITY_KINDS })
  @present
  @IsIn(LEGAL_ENTITY_KINDS)
  kind?: LegalEntityKind;

  @ApiPropertyOptional({ description: 'Off = not offered for new depots and employees.' })
  @present
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'BCA', description: 'Official account (FRANCHISOR only); empty clears.' })
  @present
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  bankName?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Digits only, 5 to 25 of them; empty clears.' })
  @present
  @Transform(trimmed)
  @Matches(/^(\d{5,25})?$/, { message: 'bankAccountNumber must be 5 to 25 digits' })
  bankAccountNumber?: string;

  @ApiPropertyOptional({ example: 'PT Indowater Waralaba', description: 'Account holder; empty clears.' })
  @present
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  bankAccountHolder?: string;

  @ApiPropertyOptional({
    description:
      'The updatedAt the form was shown. Required for a rename or a change of kind; a bare on/off toggle may leave it out.',
  })
  @IsOptional()
  @IsISO8601()
  seenUpdatedAt?: string;
}

export class AiGrantChangeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  legalEntityId!: string;

  @ApiProperty({ example: 'HEAD_OFFICE' })
  @IsString()
  @MaxLength(64)
  @Matches(ROLE_KEY)
  roleKey!: string;

  @ApiProperty({ description: 'true = this role may read the entity in the AI web; false = it may not.' })
  @IsBoolean()
  granted!: boolean;
}

export class SetAiGrantsDto {
  @ApiProperty({ type: [AiGrantChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AiGrantChangeDto)
  changes!: AiGrantChangeDto[];
}

/** What the screen showed for one row on the day being written. */
export class SeenPointDto {
  @ApiProperty({ format: 'uuid', description: 'A depot of this request.' })
  @IsUUID()
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'The legal entity the screen showed for it on that day.' })
  @IsUUID()
  legalEntityId!: string;
}

export class AssignDepotsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  depotIds!: string[];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  legalEntityId!: string;

  @ApiProperty({ example: '2026-12-01', description: 'The calendar day the depot starts belonging to it.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @ApiProperty({
    type: [SeenPointDto],
    description:
      'Every depot that already had a point on that day in the copy the screen read, with its entity. ' +
      'A depot not listed was shown with none. 409 STALE_WRITE when the stored day differs, so a ' +
      'correction never erases a write the screen did not show.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SeenPointDto)
  seen!: SeenPointDto[];
}

/** Taking back a point names the entity the screen showed on it. */
export class RemovePointQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The legal entity the screen showed on this point.' })
  @IsUUID()
  legalEntityId!: string;
}

// ---- Responses ----

export class LegalEntityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: LEGAL_ENTITY_KINDS })
  kind!: string;
  @ApiProperty()
  active!: boolean;
  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
  @ApiProperty({ type: String, nullable: true })
  bankName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bankAccountNumber!: string | null;
  @ApiProperty({ type: String, nullable: true })
  bankAccountHolder!: string | null;
}

export class LegalEntityRecordResponseDto extends LegalEntityResponseDto {
  @ApiProperty({ type: [String], description: 'Roles that may read this entity in the AI web.' })
  aiReadRoles!: string[];
}

export class AiGrantableRoleResponseDto {
  @ApiProperty()
  key!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
  @ApiProperty()
  custom!: boolean;
}

export class LegalEntityDirectoryResponseDto {
  @ApiProperty({ type: [LegalEntityRecordResponseDto] })
  entities!: LegalEntityRecordResponseDto[];
  @ApiProperty({ type: [AiGrantableRoleResponseDto] })
  roles!: AiGrantableRoleResponseDto[];
}

export class DepotLegalEntityPointResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  depotId!: string;
  @ApiProperty({ format: 'uuid' })
  legalEntityId!: string;
  @ApiProperty({ example: '2026-12-01' })
  effectiveFrom!: string;
  @ApiProperty({ type: String, nullable: true })
  recordedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: Date;
}

export class DepotLegalEntityHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  depotId!: string;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: ['WARALABA', 'HKP'] })
  ownershipType!: string;
  @ApiProperty()
  active!: boolean;
  @ApiProperty({ type: [DepotLegalEntityPointResponseDto], description: 'Newest first.' })
  points!: DepotLegalEntityPointResponseDto[];
}

export class AssignedDepotResponseDto {
  @ApiProperty({ format: 'uuid' })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true, description: 'The entity that day held before, if it was corrected.' })
  replaced!: string | null;
}

export class LegalEntitySummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: LEGAL_ENTITY_KINDS })
  kind!: string;
  @ApiProperty()
  active!: boolean;
  @ApiProperty({ type: [String], description: 'Role keys granted to read this entity in the AI web (never SUPER_ADMIN).' })
  aiReadRoles!: string[];
  @ApiProperty({ type: Object, nullable: true, description: 'HD-23: { bankName, bankAccountNumber, bankAccountHolder } when all three are entered.' })
  bankAccount!: { bankName: string; bankAccountNumber: string; bankAccountHolder: string } | null;
}

/** HD-6: which legal entity these depots belonged to over a period (calendar days, inclusive). */
export class DepotEntitiesQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'First day, YYYY-MM-DD.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-11-30', description: 'Last day (inclusive), YYYY-MM-DD, not before `from`.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @ApiProperty({ description: 'Comma-separated depot ids (1 to 100).' })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : value,
  )
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  depotIds!: string[];
}

export class DepotEntitySpanResponseDto {
  @ApiProperty({ format: 'uuid' })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null: no legal entity was recorded for the depot yet.' })
  legalEntityId!: string | null;
  @ApiProperty({ example: '2026-11-01', description: 'First day of this stretch inside the period.' })
  from!: string;
}

export class DepotEntitiesResponseDto {
  @ApiProperty({ type: [DepotEntitySpanResponseDto] })
  spans!: DepotEntitySpanResponseDto[];
}

export class AiGrantsOfRoleResponseDto {
  @ApiProperty()
  roleKey!: string;
  @ApiProperty({ description: 'True: reads every entity (SUPER_ADMIN). Otherwise only legalEntityIds.' })
  all!: boolean;
  @ApiProperty({ type: [String] })
  legalEntityIds!: string[];
}

/** HD-6 H5: which legal entities to name the kind of. */
export class EntityKindsQueryDto {
  @ApiProperty({ description: 'Comma-separated legal entity ids (1 to 100).' })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : value,
  )
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class EntityKindResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: LEGAL_ENTITY_KINDS })
  kind!: LegalEntityKind;
}

export class EntityKindsResponseDto {
  @ApiProperty({ type: [EntityKindResponseDto] })
  entities!: EntityKindResponseDto[];
}
