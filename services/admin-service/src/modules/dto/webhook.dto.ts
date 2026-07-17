import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

import { WebhookRecord } from '../../application/ports/webhook.repository';

/* ---------- Requests ---------- */

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://partner.example.com/hooks' })
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  url!: string;

  @ApiProperty({ type: [String], example: ['order.created', 'payment.settled'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  events!: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Signing secret (opaque; stored as-is).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({ example: 'https://partner.example.com/hooks' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  events?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;
}

/* ---------- Responses ---------- */

export class WebhookDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  url!: string;
  @ApiProperty({ type: [String] })
  events!: string[];
  @ApiProperty()
  active!: boolean;
  @ApiProperty({ nullable: true, description: 'Most recent delivery outcome (null until one occurs).' })
  lastDeliveryStatus!: string | null;
  @ApiProperty({ nullable: true, description: 'Rolling success rate 0..100 (null until real deliveries).' })
  deliveryRatePct!: number | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: WebhookRecord): WebhookDto {
    return {
      id: record.id,
      url: record.url,
      events: record.events,
      active: record.active,
      lastDeliveryStatus: record.lastDeliveryStatus,
      deliveryRatePct: record.deliveryRatePct,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
