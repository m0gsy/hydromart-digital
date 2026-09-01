import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { NotificationEvent } from '../../domain/notification-event';
import { NotificationStatus } from '../../domain/notification-status';
import { NotificationRecord, OpsNotificationRecord } from '../../application/ports/notification.repository';

export class SendNotificationDto {
  @ApiProperty({ enum: NotificationEvent, description: 'Lifecycle event that triggered the message.' })
  @IsEnum(NotificationEvent)
  event!: NotificationEvent;

  @ApiProperty({ example: '+6281234567890' })
  @IsString()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'phone must be 8-15 digits, optionally prefixed with +' })
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customer the notification is about (audit).' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /**
   * F8. The depot an OPERATIONAL alert is about. Ops events carry no customer — they are
   * addressed to a phone number — so this is what gives them a set of devices to reach:
   * the depot's own active staff. Ignored for customer events, which already have one.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'Depot an operational alert is about (ops push routing).' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({
    description: 'Template variables, e.g. { "name": "Budi", "orderNumber": "HM-..." }.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  vars?: Record<string, string>;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: NotificationEvent })
  event!: string;
  @ApiProperty({ nullable: true, format: 'uuid' })
  customerId!: string | null;
  @ApiProperty()
  phone!: string;
  @ApiProperty()
  message!: string;
  @ApiProperty({ enum: NotificationStatus })
  status!: NotificationStatus;
  @ApiProperty({ nullable: true })
  error!: string | null;
  /** O1: the in-app screen a tap opens, or null when this row opens nothing. */
  @ApiProperty({ nullable: true })
  destination!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(record: NotificationRecord): NotificationDto {
    return {
      id: record.id,
      event: record.event,
      customerId: record.customerId,
      phone: record.phone,
      message: record.message,
      status: record.status,
      error: record.error,
      destination: record.destination,
      createdAt: record.createdAt,
    };
  }
}

/** Ops feed row: the audit row plus the calling staff member's own read receipt. */
export class OpsNotificationDto extends NotificationDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: "When the *calling* staff member read it; null = unread by them.",
  })
  readAt!: Date | null;

  static fromOps(record: OpsNotificationRecord): OpsNotificationDto {
    return { ...NotificationDto.from(record), readAt: record.readAt };
  }
}

export class OpsReadResultDto {
  @ApiProperty({ type: String, format: 'date-time', description: 'When it was read (first read wins).' })
  readAt!: Date;
}

export class OpsReadAllResultDto {
  @ApiProperty({ description: 'How many feed rows were newly marked read (0 when already all read).' })
  marked!: number;
}

/** Retention sweep body — the cutoff is computed by admin-service, never here. */
export class PurgeNotificationsDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  cutoff!: string;
}

/**
 * UU PDP item 13 — forget one person, on request.
 *
 * `phone` rides along because half these rows carry no `customerId` at all: a campaign
 * recipient who never registered, a notification sent before the account existed. Erasing
 * by id alone is exactly how `crm.campaign_recipients` stayed populated after a deletion.
 */
export class PdpAnonymiseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ nullable: true, example: '+628123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}
