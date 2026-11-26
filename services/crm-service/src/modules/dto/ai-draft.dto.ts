import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

import { CampaignRecord } from '../../application/ports/campaign.repository';
import { CampaignListItemDto, CreateDepotCampaignDto } from './campaign.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** HD-17: why the AI drafted it; shown to the person who sends it. Max 500 characters. */
export const AI_REASON_MAX = 500;

/**
 * The depot blast a manager makes (same name/message/segment/schedule validation, same bounds),
 * plus the AI's reason. No explicit recipient list: the audience is always resolved by the
 * segment rules, so an AI cannot paste in phone numbers.
 */
export class AiCampaignDraftDto extends CreateDepotCampaignDto {
  @ApiProperty({ maxLength: AI_REASON_MAX, description: 'Why the AI proposes this campaign.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_REASON_MAX)
  // 8+ digits in a row (spaces/dashes allowed between them) is a phone number: refused.
  @Matches(/^(?![\s\S]*\d(?:[ -]*\d){7})/, { message: 'reason must not contain a phone number or other personal data' })
  reason!: string;
}

/** What the AI route answers: the draft's facts and the audience SIZE, never a recipient. */
export class AiCampaignDraftResponseDto extends CampaignListItemDto {
  @ApiProperty()
  messageTemplate!: string;
  @ApiProperty({ nullable: true, format: 'uuid' })
  aiSuggestionId!: string | null;

  static fromDraft(record: CampaignRecord): AiCampaignDraftResponseDto {
    return {
      ...CampaignListItemDto.from(record),
      messageTemplate: record.messageTemplate,
      aiSuggestionId: record.aiSuggestionId,
    };
  }
}
