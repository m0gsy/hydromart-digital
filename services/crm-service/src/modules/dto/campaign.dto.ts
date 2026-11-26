import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmpty,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { INT4_MAX, MAX_DAYS } from '@hydromart/platform';

import { DraftSource } from '../../domain/draft-source';
import { CampaignChannel } from '../../domain/channel';
import { CampaignStatus } from '../../domain/campaign-status';
import { RecipientStatus } from '../../domain/recipient-status';
import { Page } from '../../application/pagination';
import { CampaignRecipientRecord, CampaignRecord } from '../../application/ports/campaign.repository';

/* ---------- Requests ---------- */

export class RecipientInputDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Optional linked customer id.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ example: '+6281234567890', description: 'Recipient phone (8–15 digits, optional +).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone must be 8–15 digits, optionally +-prefixed' })
  phone!: string;

  @ApiPropertyOptional({ example: 'Andi', description: 'Optional name for the {{name}} token.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class CampaignSegmentDto {
  // HD-6 A7: the BASIC/SILVER/GOLD column behind this filter was never written by anything, so
  // "BASIC" matched everybody and the others matched nobody. It no longer exists; a caller that
  // still sends one is told so instead of being silently ignored (and blasting everyone).
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Removed. Sending a value answers 400; the member tier now lives in loyalty-service.',
  })
  @IsEmpty({ message: 'Filter tier sudah tidak ada. Pilih segmen berdasarkan kota atau aktivitas pelanggan.' })
  tier?: string;

  @ApiPropertyOptional({ example: 'Bandung', description: 'Filter by primary-address city.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /*
   * The activity half (design 21d), resolved from order-service. These are the conditions
   * the console screens already SIZE an audience with; before they were accepted here the
   * estimate and the send were two different segments.
   */
  @ApiPropertyOptional({ minimum: 1, description: 'Last order within this many days (still active).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  recencyDays?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'Last order OLDER than this many days (lapsed / at-risk).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  lapsedDays?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'First order within this many days (newly acquired).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  newWithinDays?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'At least this many non-cancelled orders.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  minOrders?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customers who have ordered at this depot.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Named customers (e.g. re-engaging one at-risk customer). Bounded at 500.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  customerIds?: string[];
}

export class CreateCampaignDto {
  @ApiProperty({ example: 'Ramadan Promo Blast' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: 'Hi {{name}}, enjoy 20% off your next refill!',
    description: 'Message body. Supports {{name}} and {{phone}} tokens.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  messageTemplate!: string;

  @ApiPropertyOptional({
    type: [RecipientInputDto],
    description: 'Explicit recipient list. Provide this OR `segment` (FR-087).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientInputDto)
  recipients?: RecipientInputDto[];

  @ApiPropertyOptional({
    type: CampaignSegmentDto,
    description: 'Attribute segment (city) — resolved to recipients from customer-service (FR-087).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignSegmentDto)
  segment?: CampaignSegmentDto;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When to send. Omit to send as soon as the sweep picks the campaign up.',
  })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

/**
 * A depot's own customer blast. `depotId` is top-level, not inside `segment`, because
 * DepotScopeGuard reads the body's top level — nesting it would have moved the tenant
 * check out of the guard and into somebody's memory.
 */
export class CreateDepotCampaignDto {
  @ApiProperty({ format: 'uuid', description: "The depot whose customers are targeted." })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: 'Promo galon depot Cibubur' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'Hi {{name}}, ada promo di depot langganan kamu!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  messageTemplate!: string;

  @ApiPropertyOptional({
    type: CampaignSegmentDto,
    description: 'Narrows within the depot (lapsed / new / frequent). Its depotId is ignored.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignSegmentDto)
  segment?: CampaignSegmentDto;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When to send. Omit to send as soon as the sweep picks the campaign up.',
  })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

export class CampaignPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}

/* ---------- Responses ---------- */

export class CampaignRecipientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ nullable: true, format: 'uuid' })
  customerId!: string | null;
  @ApiProperty({ example: '+6281234567890' })
  phone!: string;
  @ApiProperty({ nullable: true, example: 'Andi' })
  name!: string | null;
  @ApiProperty({ enum: RecipientStatus })
  status!: RecipientStatus;
  @ApiProperty({ nullable: true, description: 'Failure detail when status is FAILED.' })
  error!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  sentAt!: Date | null;

  static from(record: CampaignRecipientRecord): CampaignRecipientDto {
    return {
      id: record.id,
      customerId: record.customerId,
      phone: record.phone,
      name: record.name,
      status: record.status,
      error: record.error,
      sentAt: record.sentAt,
    };
  }
}

export class CampaignListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Ramadan Promo Blast' })
  name!: string;
  @ApiProperty({ enum: CampaignChannel })
  channel!: CampaignChannel;
  @ApiProperty({ enum: CampaignStatus })
  status!: CampaignStatus;
  @ApiProperty({ example: 250 })
  totalRecipients!: number;
  @ApiProperty({ example: 248 })
  sentCount!: number;
  @ApiProperty({ example: 2 })
  failedCount!: number;
  @ApiProperty({ format: 'uuid', description: 'Staff user who created the campaign.' })
  createdBy!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  sentAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time', description: 'Due time; null = immediately.' })
  scheduledFor!: Date | null;
  @ApiProperty({ enum: DraftSource, description: 'AI = a draft the AI web made; a person still presses Kirim.' })
  source!: DraftSource;
  @ApiProperty({ nullable: true, description: 'Why the AI proposed it (source AI only).' })
  aiReason!: string | null;

  static from(record: CampaignRecord): CampaignListItemDto {
    return {
      id: record.id,
      name: record.name,
      channel: record.channel,
      status: record.status,
      totalRecipients: record.totalRecipients,
      sentCount: record.sentCount,
      failedCount: record.failedCount,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      sentAt: record.sentAt,
      scheduledFor: record.scheduledFor,
      source: record.source,
      aiReason: record.aiReason,
    };
  }
}

export class CampaignDto extends CampaignListItemDto {
  @ApiProperty({ example: 'Hi {{name}}, enjoy 20% off your next refill!' })
  messageTemplate!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
  @ApiProperty({ type: [CampaignRecipientDto] })
  recipients!: CampaignRecipientDto[];

  static from(record: CampaignRecord): CampaignDto {
    return {
      ...CampaignListItemDto.from(record),
      messageTemplate: record.messageTemplate,
      updatedAt: record.updatedAt,
      recipients: record.recipients.map((r) => CampaignRecipientDto.from(r)),
    };
  }
}

export class CampaignListDto {
  @ApiProperty({ type: [CampaignListItemDto] })
  items!: CampaignListItemDto[];
  @ApiProperty({ example: 12 })
  total!: number;
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
  @ApiProperty({ example: 1 })
  totalPages!: number;

  static from(page: Page<CampaignRecord>): CampaignListDto {
    return {
      items: page.items.map((c) => CampaignListItemDto.from(c)),
      total: page.total,
      page: page.page,
      limit: page.limit,
      totalPages: page.totalPages,
    };
  }
}
