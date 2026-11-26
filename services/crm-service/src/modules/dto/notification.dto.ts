import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { AI_AGENT_NOTICE_KINDS, AiAgentNoticeKind } from '../../domain/ai-agent-notice';
import { CUSTOMER_REMINDER_KINDS, CustomerReminderKind } from '../../domain/customer-reminder';
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

  @ApiPropertyOptional({
    example: 'voucher-grant:6f1c',
    description:
      'Derived by the sender from the event it reports. A second send with the same key returns the first row and pushes nothing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  dedupeKey?: string;
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

/** AI-5: the dedupe key of the event is `franchise.application_submitted:<applicationId>`. */
export const FRANCHISE_EVENT_PREFIX = 'franchise.application_submitted:';

// Twin of PLACE_NAME_PATTERN in depot-service franchise-application.dto.ts: a place name never
// carries a link, because it goes into an email sent from our own address.
export const PLACE_NAME_PATTERN = /^(?=.*\p{L})(?!.*\.[\p{L}\p{M}]{2})[\p{L}\p{M} .,'’()-]+$/u;

/**
 * AI-5 — what n8n forwards from the signed `franchise.application_submitted` event
 * (contracts/ai-v1/events.openapi.json): its `eventId` and `data`. city and province are
 * checked as depot-service's form checks them (place-name characters only); the controller then makes each one line.
 */
export class FranchiseApplicationSubmittedDto {
  @ApiProperty({ example: 'franchise.application_submitted:3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807' })
  @IsString()
  @Matches(
    /^franchise\.application_submitted:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    { message: 'eventId must be franchise.application_submitted:<applicationId>' },
  )
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  applicationId!: string;

  @ApiProperty({ example: 'Bekasi', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(PLACE_NAME_PATTERN, {
    message: "city: kota hanya boleh berisi huruf, spasi, dan tanda . , ' ( ) -; beri spasi setelah titik",
  })
  city!: string;

  @ApiProperty({ example: 'Jawa Barat', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(PLACE_NAME_PATTERN, {
    message: "province: provinsi hanya boleh berisi huruf, spasi, dan tanda . , ' ( ) -; beri spasi setelah titik",
  })
  province!: string;
}

/** AI-9: the dedupe key of the morning summary is `morning-summary:<WIB date>`. */
export const MORNING_SUMMARY_PREFIX = 'morning-summary:';

/** AI-9 — n8n's trigger: when to send, nothing else. The counts are hydromart's own. */
export class MorningSummaryDto {
  @ApiProperty({ example: 'morning-summary:2026-11-25' })
  @IsString()
  @Matches(/^morning-summary:\d{4}-\d{2}-\d{2}$/, { message: 'eventId must be morning-summary:<YYYY-MM-DD>' })
  eventId!: string;

  @ApiProperty({ example: '2026-11-25', description: 'The WIB date of the summary: today, in Asia/Jakarta.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class MorningSummaryResultDto {
  @ApiProperty({ example: '2026-11-25' })
  date!: string;

  @ApiProperty({ description: 'Accounts holding a recipient role.' })
  recipients!: number;

  @ApiProperty({ description: 'Of those, how many have the summary of the day (a retry files none twice).' })
  notified!: number;

  @ApiProperty({ description: 'Of those, how many had nothing waiting and so got nothing.' })
  nothingWaiting!: number;

  @ApiProperty({
    enum: ['pending'],
    description: 'WhatsApp is not sent until the Meta channel is ready; never reported as sent.',
  })
  whatsapp!: 'pending';
}

/** HD-18 — n8n's trigger for one kind of customer reminder: which, and the day it believes it is. */
export class CustomerReminderDto {
  @ApiProperty({ enum: CUSTOMER_REMINDER_KINDS })
  @IsIn(CUSTOMER_REMINDER_KINDS)
  kind!: CustomerReminderKind;

  @ApiProperty({ example: '2026-11-25', description: 'The WIB date of the run: today, in Asia/Jakarta.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class CustomerReminderResultDto {
  @ApiProperty({ enum: CUSTOMER_REMINDER_KINDS })
  kind!: CustomerReminderKind;

  @ApiProperty({ example: '2026-11-25' })
  date!: string;

  @ApiProperty({ description: 'Who is due a reminder of this kind right now.' })
  candidates!: number;

  @ApiProperty({ description: 'True when more were due than one answer holds; the next tick takes the rest.' })
  truncated!: boolean;

  @ApiProperty({ description: 'Of those, how many this call filed (bell and push).' })
  notified!: number;

  @ApiProperty({ description: 'Of those, how many already had it (a retry or a later tick files none twice).' })
  skipped!: number;

  @ApiProperty({
    enum: ['pending'],
    description: 'WhatsApp is not sent until per-number consent (HD-13) is built; never reported as sent.',
  })
  whatsapp!: 'pending';
}

export class NotificationIdDto {
  @ApiProperty({ format: 'uuid', description: 'The notification row; a repeated eventId answers the same one.' })
  id!: string;
}

/** AI-7c: the data groups of the AI web an access request can name (contracts/ai-v1). */
export const AI_ACCESS_GROUPS = [
  'scope',
  'money',
  'stock',
  'loyalty',
  'franchise',
  'hr',
  'customers',
  'delivery',
  'gallons',
] as const;
export type AiAccessGroup = (typeof AI_ACCESS_GROUPS)[number];

const lowerEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.toLowerCase() : v)) : value;

/**
 * AI-7c — what n8n forwards when someone presses "Minta akses" in the AI web: ids only. The
 * requester's name and role and the entities' names are looked up here, never carried by n8n.
 */
export class AiAccessRequestedDto {
  @ApiProperty({ example: 'ai-access-request:00000000-0000-4000-8000-000000000001' })
  @IsString()
  @Matches(/^ai-access-request:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'eventId must be ai-access-request:<uuid>',
  })
  eventId!: string;

  // v4 only: auth-service's by-ids lookup refuses any other version, which would loop as a 503.
  @ApiProperty({ format: 'uuid', description: 'The account that asked (a v4 uuid).' })
  @IsUUID('4')
  requesterAccountId!: string;

  // Lower-cased first, so the same entity in two spellings is a repeat (and never a double lookup).
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 20 })
  @IsOptional()
  @Transform(lowerEach)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  legalEntityIds?: string[];

  @ApiPropertyOptional({ enum: AI_ACCESS_GROUPS })
  @IsOptional()
  @IsIn(AI_ACCESS_GROUPS)
  group?: AiAccessGroup;
}

export class AiAccessRequestedResultDto {
  @ApiProperty({ description: 'People who can grant AI access (holders of legalEntityAiAccess).' })
  recipients!: number;

  @ApiProperty({ description: 'Of those, how many now have the request (a retry files none twice).' })
  notified!: number;

  @ApiPropertyOptional({
    description:
      'True when the hourly cap on requests was reached: nothing was sent, and it is not worth retrying.',
  })
  capped?: true;

  @ApiProperty({
    enum: ['pending'],
    description: 'WhatsApp is not sent until the Meta channel is ready; never reported as sent.',
  })
  whatsapp!: 'pending';
}

/** HD-15: n8n's trigger: when to sweep, nothing else. Which items, who and what it says are hydromart's. */
export class MaintenanceDueDto {
  @ApiProperty({ example: '2026-11-26', description: 'The WIB date of the sweep: today, in Asia/Jakarta.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class MaintenanceDueResultDto {
  @ApiProperty({ example: '2026-11-26' })
  date!: string;

  @ApiProperty({ description: 'Depots with at least one item due or overdue.' })
  depots!: number;

  @ApiProperty({ description: 'Items due or overdue.' })
  items!: number;

  @ApiProperty({ description: 'Notifications filed by this call (a retry files none twice).' })
  notified!: number;

  @ApiProperty({ description: 'Items left out because they were told about less than 3 days ago.' })
  remindLater!: number;

  @ApiProperty({
    enum: ['pending'],
    description: 'WhatsApp is not sent until the Meta channel is ready; never reported as sent.',
  })
  whatsapp!: 'pending';
}

/** AI-26: the dedupe base of the weekly Sales report notice is `sales-weekly:<Monday, WIB>`. */
export const SALES_WEEKLY_PREFIX = 'sales-weekly:';

/** AI-26: n8n's trigger: which week and which legal entities, ids only. Text, recipients and numbers are not n8n's. */
export class SalesWeeklyReadyDto {
  @ApiProperty({ example: 'sales-weekly:2026-11-30' })
  @IsString()
  @Matches(/^sales-weekly:\d{4}-\d{2}-\d{2}$/, { message: 'eventId must be sales-weekly:<YYYY-MM-DD>' })
  eventId!: string;

  @ApiProperty({ example: '2026-11-23', description: 'The Monday (WIB) the reported week starts on.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekStart must be YYYY-MM-DD' })
  weekStart!: string;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 50 })
  @Transform(lowerEach)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  legalEntityIds!: string[];
}

export class SalesWeeklyReadyResultDto {
  @ApiProperty({ example: '2026-11-23' })
  weekStart!: string;
  @ApiProperty() legalEntities!: number;
  @ApiProperty({ description: 'Ids that are not a legal entity: nothing was sent for them.' })
  unknownEntities!: number;
  @ApiProperty({ description: 'Legal entities switched off: nothing was sent for them either.' })
  inactiveEntities!: number;
  @ApiProperty({ description: 'People who may read these entities reports.' })
  recipients!: number;
  @ApiProperty({ description: 'Of those, how many have the notice (a retry files none twice).' })
  notified!: number;
  @ApiProperty({ enum: ['pending'] })
  whatsapp!: 'pending';
}


/** AI-31: n8n relays an agent event of the AI web: ids and a kind. The words and the recipients are hydromart's. */
export class AiAgentNoticeDto {
  @ApiProperty({ example: 'agent-flag:7c1f0f64' })
  @IsString()
  @Matches(/^[A-Za-z0-9:._-]{1,120}$/, { message: 'eventId: 1 to 120 characters of A-Z a-z 0-9 : . _ -' })
  eventId!: string;

  @ApiProperty({ example: 'kasir-depot' })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,39}$/, { message: 'agentId must be a lower-case slug' })
  agentId!: string;

  @ApiProperty({ example: 'Agen Stok', maxLength: 40 })
  @IsString()
  @Matches(/^[\p{L}\p{N} ]{1,40}$/u, { message: 'agentName: letters, digits and spaces, 40 at most' })
  agentName!: string;

  @ApiProperty({ enum: AI_AGENT_NOTICE_KINDS })
  @IsIn(AI_AGENT_NOTICE_KINDS)
  kind!: AiAgentNoticeKind;

  @ApiPropertyOptional({ example: 'FINANCE', description: "The agent's boss role (built-in key or custom role key)." })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, { message: 'bossRole must be a role key' })
  bossRole?: string;
}

export class AiAgentNoticeResultDto {
  @ApiProperty({ description: 'People who manage the AI team, plus the boss role holders that may read it.' })
  recipients!: number;
  @ApiProperty({ description: 'Of those, how many have the notice (a retry files none twice).' })
  notified!: number;
  @ApiProperty({ enum: ['pending'] })
  whatsapp!: 'pending';
}

/** HD-15B: depot-service tells crm about one visit's findings, or one depot's overdue follow-ups. */
export class VisitNoticeDto {
  @ApiProperty({ enum: ['FINDING', 'OVERDUE'] })
  @IsIn(['FINDING', 'OVERDUE'])
  kind!: 'FINDING' | 'OVERDUE';

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: 'Depot Pekayon' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  depotName!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The visit (required for FINDING).' })
  @IsOptional()
  @IsUUID()
  visitId?: string;

  @ApiProperty({ example: '2026-11-26', description: 'The WIB day of the notice.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateKey!: string;

  @ApiProperty({ type: [String], description: 'One line per finding, 30 at most.' })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  items!: string[];
}

export class VisitNoticeResultDto {
  @ApiProperty({ description: 'People who had to be told.' })
  recipients!: number;

  @ApiProperty({ description: 'Notifications filed by this call (a retry files none twice).' })
  notified!: number;
}

class PartnerBillBankDto {
  @ApiProperty({ example: 'BCA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  bankName!: string;

  @ApiProperty({ example: '1234567890' })
  @Matches(/^\d{5,25}$/)
  bankAccountNumber!: string;

  @ApiProperty({ example: 'PT Indowater' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  bankAccountHolder!: string;
}

/** HD-23: payout-service tells crm a royalty bill was approved. The numbers are its own. */
export class PartnerBillNoticeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  billId!: string;

  @ApiProperty({ example: 'Oktober 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  monthLabel!: string;

  @ApiProperty({ example: 'PT Mitra Air' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalEntityName!: string;

  @ApiProperty({ example: 1500000, description: 'Whole rupiah.' })
  @IsInt()
  @Min(1)
  totalIdr!: number;

  @ApiProperty({ type: PartnerBillBankDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PartnerBillBankDto)
  bank!: PartnerBillBankDto;

  @ApiProperty({ type: [String], format: 'uuid', description: 'The franchise-owner accounts to tell.' })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  recipientIds!: string[];
}

export class PartnerBillNoticeResultDto {
  @ApiProperty({ description: 'Owners that had to be told.' })
  recipients!: number;

  @ApiProperty({ description: 'Notices filed by this call (a retry files none twice).' })
  notified!: number;
}
