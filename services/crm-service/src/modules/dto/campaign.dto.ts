import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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

  @ApiProperty({ type: [RecipientInputDto], description: 'Explicit recipient list (min 1).' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipientInputDto)
  recipients!: RecipientInputDto[];
}

export class CampaignPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
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
