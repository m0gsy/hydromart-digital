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

export class UpdateLegalEntityDto {
  @ApiPropertyOptional({ example: 'PT Contoh Air Nusantara' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: LEGAL_ENTITY_KINDS })
  @IsOptional()
  @IsIn(LEGAL_ENTITY_KINDS)
  kind?: LegalEntityKind;

  @ApiPropertyOptional({ description: 'Off = not offered for new depots and employees.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

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
}
