import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { WhatsappAdminService } from '../application/services/whatsapp-admin.service';
import { WhatsappService } from '../application/services/whatsapp.service';
import { PurgeNotificationsDto } from './dto/notification.dto';
import { CrmConfigService } from '../config/crm-config.service';

/**
 * The scheduler's WhatsApp retry sweep and admin-service's three retention purges. Internal key only.
 * While the channel is off the sweep claims and sends nothing and answers 200 `{ off: true }`, not 404: the
 * scheduler pages a non-2xx as a FAILED sweep, which would page every minute for as long as WhatsApp is off.
 * The purges run regardless: retention must keep going after the channel is switched off again, and a purge
 * only ever deletes.
 */
@ApiExcludeController()
// Scheduler and admin-service calls, authed by the internal key: not a public surface to throttle.
@SkipThrottle()
@Controller({ path: 'whatsapp/internal', version: '1' })
export class WhatsappInternalController {
  constructor(
    private readonly config: CrmConfigService,
    private readonly whatsapp: WhatsappService,
    private readonly admin: WhatsappAdminService,
  ) {}

  @ApiOkResponse({ description: 'Counts for this round, or { off: true } while WhatsApp is off.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Post('process-queue')
  @HttpCode(HttpStatus.OK)
  async processQueue() {
    if (!this.config.whatsapp.ready) return { off: true, claimed: 0 };
    const round = await this.whatsapp.processQueue();
    // The scheduler's verdict: a round that tried and delivered nothing but failures is not a working sweep.
    return { ...round, ok: round.claimed === 0 || round.failed < round.claimed };
  }

  @ApiOkResponse({ description: 'Rows deleted.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Post('purge-messages')
  @HttpCode(HttpStatus.OK)
  purgeMessages(@Body() dto: PurgeNotificationsDto) {
    return this.admin.purgeMessages(new Date(dto.cutoff));
  }

  @ApiOkResponse({ description: 'Rows deleted.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Post('purge-inbound')
  @HttpCode(HttpStatus.OK)
  purgeInbound(@Body() dto: PurgeNotificationsDto) {
    return this.admin.purgeInbound(new Date(dto.cutoff));
  }

  @ApiOkResponse({ description: 'Rows deleted.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Post('purge-consents')
  @HttpCode(HttpStatus.OK)
  purgeConsents(@Body() dto: PurgeNotificationsDto) {
    return this.admin.purgeConsents(new Date(dto.cutoff));
  }
}
