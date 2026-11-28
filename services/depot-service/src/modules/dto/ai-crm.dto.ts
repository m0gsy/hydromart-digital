import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

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

/** AI-29: what the signed-in person may do on the AI web's "Tim AI" screen (the agents). */
export class AiTeamAccessResponseDto {
  @ApiProperty({ description: 'Holds aiTeamRead: may open the screen.' }) read!: boolean;
  @ApiProperty({ description: 'Holds aiTeamManage: switch agents on, change caps, approve playbooks.' }) manage!: boolean;
  @ApiProperty({ description: 'Holds aiTeamStop: stop an agent.' }) stop!: boolean;
  @ApiProperty({ description: "The person's role key, for the AI web's agent -> boss role rule." }) role!: string;
}

/** AI-11: what the signed-in person may do in the AI web's CS inbox (WhatsApp number 2). */
export class AiCsAccessResponseDto {
  @ApiProperty({ description: 'Holds aiCsRead: may open the inbox and read threads.' }) read!: boolean;
  @ApiProperty({ description: 'Holds aiCsReply: may claim and answer a chat.' }) reply!: boolean;
  @ApiProperty({ description: 'Holds aiCsManage: takes over, closes any chat, edits caps and pauses.' }) manage!: boolean;
  @ApiProperty({ format: 'uuid', description: "The person's account id (the AI web's claim is by this id)." }) accountId!: string;
  @ApiProperty({ description: "The person's role key." }) role!: string;
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

/** HD-21b: GET depot-drafts, HQ's queue. */
export class ListDepotDraftsQueryDto {
  @ApiPropertyOptional({ default: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVATED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVATED', 'REJECTED'])
  status?: 'DRAFT' | 'ACTIVATED' | 'REJECTED';
}

/** HD-21b: POST depot-drafts/:id/reject. The note is required: the CRM shows it to whoever reopens the draft. */
export class RejectDepotDraftDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  note!: string;
}
