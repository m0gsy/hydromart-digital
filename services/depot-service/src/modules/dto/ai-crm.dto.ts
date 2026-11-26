import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';

import { CHECKLIST_STATES, ChecklistState } from '../../domain/depot-draft';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// No backslashes on purpose: character classes only.
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const PHONE = /^[+]62[0-9]{8,13}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class CrmOwnerDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty({ example: '+6281234567890' })
  @Transform(trim)
  @Matches(PHONE, { message: 'phoneE164 must be an Indonesian number in E.164 form (+62...)' })
  phoneE164!: string;
}

export class CrmChecklistDto {
  @ApiProperty({ enum: CHECKLIST_STATES })
  @IsIn(CHECKLIST_STATES)
  ktpNpwp!: ChecklistState;
  @ApiProperty({ enum: CHECKLIST_STATES })
  @IsIn(CHECKLIST_STATES)
  locationProof!: ChecklistState;
  @ApiProperty({ enum: CHECKLIST_STATES })
  @IsIn(CHECKLIST_STATES)
  capitalDeposit!: ChecklistState;
  @ApiProperty({ enum: CHECKLIST_STATES })
  @IsIn(CHECKLIST_STATES)
  fieldSurvey!: ChecklistState;
}

/** HD-21a: POST ai/drafts/depots/from-crm. Dates are WIB calendar days. */
export class CrmDepotDraftDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  prospectId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  legacyApplicationId?: string | null;

  @ApiProperty({ minLength: 3, maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(3, 80)
  proposedName!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  city!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  province!: string;

  @ApiProperty({ type: CrmOwnerDto })
  @ValidateNested()
  @Type(() => CrmOwnerDto)
  owner!: CrmOwnerDto;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(DAY, { message: 'prospectusHandedOn must be YYYY-MM-DD' })
  prospectusHandedOn!: string;

  @ApiProperty({ description: '64 lowercase hex' })
  @Matches(SHA256, { message: 'prospectusSha256 must be 64 lowercase hex characters' })
  prospectusSha256!: string;

  @ApiProperty({ minLength: 1, maxLength: 40 })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  prospectusVersionLabel!: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  prospectusReceipt!: string;

  @ApiProperty({ example: '2026-11-20' })
  @Matches(DAY, { message: 'agreementSignedOn must be YYYY-MM-DD' })
  agreementSignedOn!: string;

  @ApiProperty({ type: CrmChecklistDto })
  @ValidateNested()
  @Type(() => CrmChecklistDto)
  checklist!: CrmChecklistDto;
}

export class CrmAccessLegalEntityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class CrmAccessResponseDto {
  @ApiProperty({ description: 'Holds prospectCrm (full CRM, phones, writes).' }) full!: boolean;
  @ApiProperty({ description: 'Holds prospectSettings (thresholds, legacy import).' }) settings!: boolean;
  @ApiProperty({ type: CrmAccessLegalEntityDto, isArray: true }) legalEntities!: CrmAccessLegalEntityDto[];
}

export class CrmDepotDraftResponseDto {
  @ApiProperty({ format: 'uuid' }) draftId!: string;
  @ApiProperty({ enum: ['DRAFT'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CrmDepotDraftStatusResponseDto {
  @ApiProperty({ format: 'uuid' }) draftId!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVATED', 'REJECTED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) decisionNote!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) depotId!: string | null;
  @ApiProperty({ nullable: true, type: String }) depotCode!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
