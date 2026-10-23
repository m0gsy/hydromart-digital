import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  ShiftReminderResult,
  ShiftReminderService,
} from '../application/services/shift-reminder.service';
import { ShiftReminderResponseDto } from './dto/shift-reminder.dto';

/**
 * The scheduler's door (crontab: every 15 minutes). Internal key only, the same shape as
 * `announcements/publish-due`.
 */
@ApiTags('HR Shift')
@Controller({ path: 'shifts/internal', version: '1' })
export class ShiftReminderController {
  constructor(private readonly reminders: ShiftReminderService) {}

  @ApiOkResponse({ type: ShiftReminderResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('remind-starting')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remind rota employees whose shift starts soon (internal)' })
  remindStarting(): Promise<ShiftReminderResult> {
    return this.reminders.remindStartingSoon(new Date());
  }
}
