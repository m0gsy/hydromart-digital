import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsString, ValidateNested } from 'class-validator';

import {
  AdminNotificationPrefRecord,
  NotificationChannelPref,
} from '../../application/ports/admin-notification-pref.repository';
import { NOTIFICATION_EVENT_IDS } from '../../application/services/admin-notification-pref.service';

/* ---------- Requests ---------- */

export class NotificationChannelPrefDto {
  @ApiProperty({ enum: NOTIFICATION_EVENT_IDS })
  @IsString()
  @IsIn(NOTIFICATION_EVENT_IDS as unknown as string[])
  id!: string;

  @ApiProperty()
  @IsBoolean()
  push!: boolean;

  @ApiProperty()
  @IsBoolean()
  email!: boolean;

  @ApiProperty()
  @IsBoolean()
  wa!: boolean;
}

export class SaveAdminNotificationPrefsDto {
  @ApiProperty({ type: [NotificationChannelPrefDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NotificationChannelPrefDto)
  events!: NotificationChannelPrefDto[];
}

/* ---------- Responses ---------- */

export class AdminNotificationPrefsDto {
  @ApiProperty({ type: [NotificationChannelPrefDto] })
  events!: NotificationChannelPref[];
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: AdminNotificationPrefRecord): AdminNotificationPrefsDto {
    return { events: record.channels, updatedAt: record.updatedAt };
  }
}
