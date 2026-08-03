import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { WebhookDeliveryRecord } from '../../application/ports/webhook.repository';

export class PublishEventDto {
  /** `domain.thing_happened` — the same string an endpoint subscribes to. */
  @ApiProperty({ example: 'delivery.delivered' })
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, {
    message: 'event must look like "domain.thing_happened"',
  })
  event!: string;

  @ApiProperty({ description: 'Event body delivered to the partner under `data`.' })
  @IsDefined()
  payload!: unknown;

  @ApiPropertyOptional({ description: 'When it happened; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
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
