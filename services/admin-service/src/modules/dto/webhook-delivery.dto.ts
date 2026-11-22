import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { WebhookDeliveryRecord } from '../../application/ports/webhook.repository';
import { WEBHOOK_EVENTS } from '../../domain/webhook-delivery';

export class PublishEventDto {
  /** `domain.thing_happened` — the same string an endpoint subscribes to (HD-7: a closed list). */
  @ApiProperty({ enum: WEBHOOK_EVENTS, example: 'delivery.delivered' })
  @IsString()
  @IsIn(WEBHOOK_EVENTS, { message: `event must be one of: ${WEBHOOK_EVENTS.join(', ')}` })
  event!: string;

  @ApiProperty({ description: 'Event body delivered to the partner under `data`.' })
  @IsDefined()
  payload!: unknown;

  @ApiPropertyOptional({ description: 'When it happened; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  /*
   * HD-7: required. It is what a receiver dedupes on, and what makes a producer's retry the
   * same event here (unique per endpoint). Every producer already sends one.
   */
  @ApiProperty({
    description: 'Producer idempotency key: publishing the same key again queues nothing new.',
    example: 'delivery.delivered:6f1c',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  eventId!: string;
}

export class ListDeliveriesDto {
  @ApiPropertyOptional({ example: 'delivery.delivered' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  event?: string;

  // Bounded on purpose: an unbounded `limit` on a table that grows with every event is a
  // page of 100,000 rows waiting to happen (H-45).
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class WebhookDeliveryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) endpointId!: string;
  @ApiProperty() event!: string;
  @ApiProperty() payload!: unknown;
  @ApiProperty({ enum: ['PENDING', 'DELIVERED', 'FAILED', 'DEAD'] }) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({ type: String, format: 'date-time' }) nextAttemptAt!: string;
  @ApiProperty({ nullable: true }) responseStatus!: number | null;
  @ApiProperty({ nullable: true }) lastError!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deliveredAt!: string | null;

  static from(record: WebhookDeliveryRecord): WebhookDeliveryDto {
    return {
      id: record.id,
      endpointId: record.endpointId,
      event: record.event,
      payload: record.payload,
      status: record.status,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt.toISOString(),
      responseStatus: record.responseStatus,
      lastError: record.lastError,
      occurredAt: record.occurredAt.toISOString(),
      deliveredAt: record.deliveredAt?.toISOString() ?? null,
    };
  }
}
