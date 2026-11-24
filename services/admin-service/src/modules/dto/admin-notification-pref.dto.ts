import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  AdminNotificationPrefRecord,
  NotificationChannelPref,
} from '../../application/ports/admin-notification-pref.repository';
import {
  NOTIFICATION_EVENT_IDS,
  PUSH_TOGGLE_IDS,
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

/** crm-service's question: of these accounts, who switched push off for this toggle? */
export class PushDisabledDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Account ids to check (at most 500).' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  accountIds!: string[];

  @ApiProperty({ enum: PUSH_TOGGLE_IDS })
  @IsString()
  @IsIn(PUSH_TOGGLE_IDS as unknown as string[])
  toggle!: string;
}

/**
 * crm's email for one staff notification it just filed: the accounts it is for, its switch, and
 * its copy. Plain text; the subject is sent as one line.
 */
export class StaffEmailDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Who the notification is for (at most 500).' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  accountIds!: string[];

  @ApiProperty({ enum: NOTIFICATION_EVENT_IDS, description: 'The switch, the same id as its push.' })
  @IsString()
  @IsIn(NOTIFICATION_EVENT_IDS as unknown as string[])
  toggle!: string;

  // Room for a template plus two 100-character vars (a calon mitra's city and province).
  @ApiProperty({ example: 'Lamaran waralaba baru: calon mitra di Bekasi, Jawa Barat', maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  subject!: string;

  @ApiProperty({ description: 'Plain-text body; the link and the switch line are added here.', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;

  @ApiProperty({ example: '/hq/applications/detail?id=3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @Matches(/^\/[^\s\p{Cc}]*$/u, { message: 'path must be a path on the web app, starting with /' })
  path!: string;
}

/* ---------- Responses ---------- */

export class StaffEmailResultDto {
  @ApiProperty({ description: 'Messages the SMTP server accepted.' })
  sent!: number;
  @ApiProperty({ description: 'Messages it refused or could not be reached for (logged with the reason).' })
  failed!: number;
  @ApiProperty({ description: 'Not attempted: email switched off, not an active staff login, no address, or no SMTP.' })
  skipped!: number;
}

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
