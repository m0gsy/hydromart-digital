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

import { NotificationService } from '../application/services/notification.service';
import { NotificationEvent } from '../domain/notification-event';
import {
  FRANCHISE_EVENT_PREFIX,
  FranchiseApplicationSubmittedDto,
  NotificationIdDto,
} from './dto/notification.dto';

/**
 * One line of visible text, for a value typed into a public form that ends up in a staff
 * feed and a phone's tray: invisible format characters (zero-width, bidi overrides) dropped,
 * control characters and runs of whitespace (newlines, tabs) read as one space, then trimmed.
 */
const oneLine = (value: string): string =>
  value.replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').trim();

/*
 * AI-5 — notifications a machine account (n8n) raises in hydromart's own staff feed and push.
 * Only a `machine` ES256 token is admitted, and only with the route's capability in its scopes
 * (a staff token needs the capability itself, which no role but SUPER_ADMIN holds). Each call is
 * written to the audit trail before it runs and refused with 503 when it cannot be.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications/external', version: '1' })
export class NotificationExternalController {
  constructor(private readonly notifications: NotificationService) {}

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
  @ApiOperation({ summary: 'n8n: tell the application reviewers a franchise application arrived (AI-5)' })
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
}
