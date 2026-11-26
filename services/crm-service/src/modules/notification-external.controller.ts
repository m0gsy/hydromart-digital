import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can, ExternalAccess } from '@hydromart/platform';

import { AiAccessRequestService } from '../application/services/ai-access-request.service';
import { ComplianceDueService } from '../application/services/compliance-due.service';
import { CustomerReminderService } from '../application/services/customer-reminder.service';
import { MaintenanceDueService } from '../application/services/maintenance-due.service';
import { MorningSummaryService } from '../application/services/morning-summary.service';
import { NotificationService } from '../application/services/notification.service';
import { oneLine } from '../domain/ai-access-request';
import { wibDate } from '../domain/morning-summary';
import { NotificationEvent } from '../domain/notification-event';
import {
  AiAccessRequestedDto,
  AiAccessRequestedResultDto,
  ComplianceDueDto,
  ComplianceDueResultDto,
  CustomerReminderDto,
  CustomerReminderResultDto,
  FRANCHISE_EVENT_PREFIX,
  FranchiseApplicationSubmittedDto,
  MaintenanceDueDto,
  MaintenanceDueResultDto,
  MORNING_SUMMARY_PREFIX,
  MorningSummaryDto,
  MorningSummaryResultDto,
  NotificationIdDto,
} from './dto/notification.dto';

/*
 * AI-5 — notifications a machine account (n8n) raises in hydromart's own staff feed and push.
 * Only a `machine` ES256 token is admitted, and only with the route's capability in its scopes.
 * An ES256 token that is not a machine's (the AI web's, whatever the person's role) is refused. A
 * staff session token is checked by @Can alone: only SUPER_ADMIN holds these capabilities, so only
 * a superuser session (audited as that person) gets in besides n8n. Each call is written to the audit trail before it runs and refused with 503 when it cannot be.
 *
 * Owner rule 24 Nov 2026: every kind raised here also goes out by email (and by WhatsApp once
 * Meta is ready). A new kind needs its entry in STAFF_EMAIL_TEMPLATES and a switch in
 * STAFF_TOGGLE_FOR_EVENT; staff-email.spec.ts reads this file and fails a kind without them.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications/external', version: '1' })
export class NotificationExternalController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly morningSummary: MorningSummaryService,
    private readonly aiAccessRequests: AiAccessRequestService,
    private readonly customerReminders: CustomerReminderService,
    private readonly maintenanceDue: MaintenanceDueService,
    private readonly complianceDue: ComplianceDueService,
  ) {}

  /*
   * A calon mitra applied on /waralaba. depot-service raised the signed event, the AI web took
   * it, n8n calls this with its fields. Told: the accounts that may review applications
   * (APPROVER_CAP_FOR_EVENT). `eventId` is the dedupe key: a retry or a replay of the same
   * event answers the same row and pushes nothing twice.
   */
  @ExternalAccess('machine')
  @Can('franchiseApplicationNotify')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('franchise-application-submitted')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'n8n: tell the application reviewers a franchise application arrived (AI-5)',
  })
  @ApiOkResponse({ type: NotificationIdDto })
  async franchiseApplicationSubmitted(
    @Body() dto: FranchiseApplicationSubmittedDto,
  ): Promise<NotificationIdDto> {
    // One spelling, so an upper-case retry is still the same event (and the same dedupe key).
    const applicationId = dto.applicationId.toLowerCase();
    const eventId = dto.eventId.toLowerCase();
    if (eventId !== `${FRANCHISE_EVENT_PREFIX}${applicationId}`) {
      throw new BadRequestException(`eventId must be ${FRANCHISE_EVENT_PREFIX}<applicationId>`);
    }
    const city = oneLine(dto.city);
    const province = oneLine(dto.province);
    if (!city || !province) {
      throw new BadRequestException('city and province must contain visible text');
    }
    // No phone: the row is for the accounts holding `franchiseApplications`, not a number.
    // An empty one is never matched by PDP erasure, which erases by phone only when given one.
    const row = await this.notifications.notify(
      NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED,
      '',
      { city, province, applicationId },
      null,
      null,
      eventId,
    );
    return { id: row.id };
  }

  /*
   * AI-9: the Direksi morning summary. n8n only says "now"; hydromart picks the recipients, asks
   * dashboard-service for each one's own approval queues and files one notification each
   * (NotificationEvent.MORNING_SUMMARY: bell and push, email). `eventId` is
   * morning-summary:<WIB date> and the date must be today in Asia/Jakarta, so a replay of an old
   * trigger cannot send today's counts under yesterday's name. A retry sends nothing twice.
   */
  @ExternalAccess('machine')
  @Can('morningSummaryNotify')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('morning-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'n8n: trigger the Direksi morning summary (AI-9)' })
  @ApiOkResponse({ type: MorningSummaryResultDto })
  async morningSummaryRun(@Body() dto: MorningSummaryDto): Promise<MorningSummaryResultDto> {
    const { eventId } = dto;
    if (eventId !== `${MORNING_SUMMARY_PREFIX}${dto.date}`) {
      throw new BadRequestException(`eventId must be ${MORNING_SUMMARY_PREFIX}<date>`);
    }
    if (dto.date !== wibDate(new Date())) {
      throw new BadRequestException('date must be today in Asia/Jakarta');
    }
    return this.morningSummary.run(eventId, dto.date);
  }

  /*
   * HD-18: n8n says "now" for one kind of customer reminder (SUBSCRIPTION_TOMORROW,
   * POINTS_EXPIRING, UNPAID_ORDER); hydromart decides who is due and files one in-app notice
   * (bell and push, respecting the customer's own switches) per customer per thing, deduped by
   * key. `date` must be today in Asia/Jakarta, like the morning summary. WhatsApp: `pending`.
   */
  @ExternalAccess('machine')
  @Can('customerReminderNotify')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('customer-reminders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'n8n: trigger one kind of customer reminder (HD-18)' })
  @ApiOkResponse({ type: CustomerReminderResultDto })
  async customerRemindersRun(@Body() dto: CustomerReminderDto): Promise<CustomerReminderResultDto> {
    if (dto.date !== wibDate(new Date())) {
      throw new BadRequestException('date must be today in Asia/Jakarta');
    }
    return this.customerReminders.run(dto.kind, dto.date);
  }

  /*
   * AI-7c: someone in the AI web pressed "Minta akses". n8n passes ids only (the event's eventId,
   * the requester and what was asked); hydromart looks up the names, composes the text and tells
   * whoever holds `legalEntityAiAccess`. A requester who does not exist or can already grant
   * access answers 200 with notified 0, so the route says nothing about who exists.
   */
  @ExternalAccess('machine')
  @Can('aiAccessRequestNotify')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('ai-access-requested')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'n8n: tell the people who can grant AI web access that someone asked (AI-7c)',
  })
  @ApiOkResponse({ type: AiAccessRequestedResultDto })
  async aiAccessRequested(@Body() dto: AiAccessRequestedDto): Promise<AiAccessRequestedResultDto> {
    // One spelling, so an upper-case retry is still the same event (and the same dedupe key).
    return this.aiAccessRequests.run(
      dto.eventId.toLowerCase(),
      dto.requesterAccountId.toLowerCase(),
      dto.legalEntityIds?.map((id) => id.toLowerCase()),
      dto.group,
    );
  }

  /*
   * HD-15: n8n's daily maintenance sweep. It only says "now"; hydromart asks depot-service which
   * items are due by days or by water volume, tells each depot's Kepala, the supervisors over it
   * and HQ Operasional once per item and then every 3 days while it stays due, and answers the
   * counts. `date` must be today in Asia/Jakarta, so a replay of an old trigger cannot be sent
   * under today's name. A retry the same day sends nothing twice.
   */
  @ExternalAccess('machine')
  @Can('maintenanceDueNotify')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('maintenance-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'n8n: tell who must know that depot maintenance is due (HD-15)' })
  @ApiOkResponse({ type: MaintenanceDueResultDto })
  async maintenanceDueRun(@Body() dto: MaintenanceDueDto): Promise<MaintenanceDueResultDto> {
    if (dto.date !== wibDate(new Date())) {
      throw new BadRequestException('date must be today in Asia/Jakarta');
    }
    return this.maintenanceDue.run(dto.date);
  }

  /*
   * HD-14: n8n's daily permit and lab-test sweep, the twin of maintenance-due: depot-service says
   * what is due, hydromart tells the depot's Kepala, supervisors and HQ Operasional. Never held
   * back by a quality hold. `date` must be today in Asia/Jakarta.
   */
  @ExternalAccess('machine')
  @Can('complianceDueNotify')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('compliance-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'n8n: tell who must know that depot permits or lab tests are due (HD-14)' })
  @ApiOkResponse({ type: ComplianceDueResultDto })
  async complianceDueRun(@Body() dto: ComplianceDueDto): Promise<ComplianceDueResultDto> {
    if (dto.date !== wibDate(new Date())) {
      throw new BadRequestException('date must be today in Asia/Jakarta');
    }
    return this.complianceDue.run(dto.date);
  }
}
