import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsPublicHttpsUrl } from '@hydromart/platform';

import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { WebhookRecord } from '../../application/ports/webhook.repository';

/* ---------- Requests ---------- */

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://partner.example.com/hooks' })
  @IsPublicHttpsUrl()
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

  /*
   * AUTHZ-3. The partner API answers "deliveries sent to you"; this is what "you" means.
   * An endpoint with no key assigned is readable by HQ and by no partner at all — so an
   * integration that is meant to read its own traffic back needs this set.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'Partner API key that owns this endpoint.' })
  @IsOptional()
  @IsUUID()
  apiKeyId?: string;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({ example: 'https://partner.example.com/hooks' })
  @IsOptional()
  @IsPublicHttpsUrl()
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

  /** Reassign (or, with null, clear) the owning partner key — see CreateWebhookDto. */
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  apiKeyId?: string | null;
}

/* ---------- Responses ---------- */

export class WebhookDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  url!: string;
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Owning partner API key.' })
  apiKeyId!: string | null;
  @ApiProperty({ type: [String] })
  events!: string[];
  @ApiProperty()
  active!: boolean;
  @ApiProperty({
    nullable: true,
    description: 'Most recent delivery outcome (null until one occurs).',
  })
  lastDeliveryStatus!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Rolling success rate 0..100 (null until real deliveries).',
  })
  deliveryRatePct!: number | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: WebhookRecord): WebhookDto {
    return {
      id: record.id,
      url: record.url,
      apiKeyId: record.apiKeyId ?? null,
      events: record.events,
      active: record.active,
      lastDeliveryStatus: record.lastDeliveryStatus,
      deliveryRatePct: record.deliveryRatePct,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
