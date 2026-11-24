import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { AdminNotificationPrefService } from '../application/services/admin-notification-pref.service';
import { StaffEmailService } from '../application/services/staff-email.service';
import {
  PushDisabledDto,
  PushDisabledResponseDto,
  StaffEmailDto,
  StaffEmailResultDto,
} from './dto/admin-notification-pref.dto';

/**
 * What crm-service asks of the staff notification prefs: "of these accounts, who has switched
 * push off for this toggle?", and "email this notification to whoever has email on for it".
 * Internal key only - crm has no user to speak for when a cron, a stock write or n8n raises a
 * notification, and both name accounts, so they are not for a browser.
 */
@ApiTags('Notification preferences')
@Controller({ path: 'notification-prefs/internal', version: '1' })
export class NotificationPrefsInternalController {
  constructor(
    private readonly prefs: AdminNotificationPrefService,
    private readonly email: StaffEmailService,
  ) {}

  @ApiOkResponse({ type: PushDisabledResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('push-disabled')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Which accounts switched push off for a toggle (internal)' })
  async pushDisabled(@Body() dto: PushDisabledDto): Promise<PushDisabledResponseDto> {
    return { disabled: await this.prefs.pushDisabledFor(dto.accountIds, dto.toggle) };
  }

  /**
   * The email channel of a staff notification crm just filed (owner rule 24 Nov 2026). Answers
   * after the sends; a refused send is counted, never an error. See StaffEmailService.
   */
  @ApiOkResponse({ type: StaffEmailResultDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a staff notification to the accounts with email on for it (internal)' })
  emailStaff(@Body() dto: StaffEmailDto): Promise<StaffEmailResultDto> {
    return this.email.send(dto);
  }
}
