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

/**
 * CA-2-37: the create response, and the ONE time the signing secret is readable.
 *
 * `WebhookDto` deliberately does not carry the secret — a list endpoint that hands out
 * every endpoint's signing key turns one leaked read into forged deliveries against every
 * partner. But a secret nobody can read is a secret nobody can configure, which is how
 * every console-registered webhook ended up unsigned: the console had no field to send one
 * and no way to learn the one it was given.
 *
 * Same shape as `CreatedApiKeyDto` in this service, for the same reason.
 */
export class CreatedWebhookDto extends WebhookDto {
  @ApiProperty({
    description: 'Signing secret. Shown ONCE, at creation — it is not readable afterwards.',
  })
  secret!: string;

  static fromSecret(record: WebhookRecord): CreatedWebhookDto {
    return { ...WebhookDto.from(record), secret: record.secret ?? '' };
  }
}
