import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import {
  AdminNotificationPrefRecord,
  NotificationChannelPref,
} from '../../application/ports/admin-notification-pref.repository';
import {
  DEPOT_EVENT_IDS,
  NOTIFICATION_EVENT_IDS,
} from '../../application/services/admin-notification-pref.service';

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

/** crm-service's question: of these accounts, who switched push off for this depot toggle? */
export class PushDisabledDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Account ids to check (at most 500).' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  accountIds!: string[];

  @ApiProperty({ enum: DEPOT_EVENT_IDS })
  @IsString()
  @IsIn(DEPOT_EVENT_IDS as unknown as string[])
  toggle!: string;
}

/* ---------- Responses ---------- */

export class PushDisabledResponseDto {
  @ApiProperty({ type: [String], description: 'The accounts that have push off for the toggle.' })
  disabled!: string[];
}

export class AdminNotificationPrefsDto {
  @ApiProperty({ type: [NotificationChannelPrefDto] })
  events!: NotificationChannelPref[];
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: AdminNotificationPrefRecord): AdminNotificationPrefsDto {
    return { events: record.channels, updatedAt: record.updatedAt };
  }
}
