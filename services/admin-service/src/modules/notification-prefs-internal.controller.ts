import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { AdminNotificationPrefService } from '../application/services/admin-notification-pref.service';
import { PushDisabledDto, PushDisabledResponseDto } from './dto/admin-notification-pref.dto';

/**
 * The one question crm-service asks about staff notification prefs: "of these accounts, who
 * has switched push off for this toggle?". Internal key only - crm has no user to speak for
 * when a cron or a stock write raises an alert, and the answer names accounts, so it is not
 * for a browser.
 */
@ApiTags('Notification preferences')
@Controller({ path: 'notification-prefs/internal', version: '1' })
export class NotificationPrefsInternalController {
  constructor(private readonly prefs: AdminNotificationPrefService) {}

  @ApiOkResponse({ type: PushDisabledResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('push-disabled')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Which accounts switched push off for a depot toggle (internal)' })
  async pushDisabled(@Body() dto: PushDisabledDto): Promise<PushDisabledResponseDto> {
    return { disabled: await this.prefs.pushDisabledFor(dto.accountIds, dto.toggle) };
  }
}
