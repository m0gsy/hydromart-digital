import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { EventRelayService, EventRelaySweepResult } from '../application/services/event-relay.service';

/** AAS-11: the scheduler's entry point for re-sending partner events admin has not taken. */
@ApiTags('Webhook outbox (internal)')
@Controller({ path: 'webhook-outbox', version: '1' })
export class EventOutboxController {
  constructor(private readonly relay: EventRelayService) {}

  @ApiOkResponse({ description: 'Counts for this sweep: claimed, delivered, failed, dead, ok.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-send every partner event still owed to admin-service (scheduler)' })
  process(): Promise<EventRelaySweepResult> {
    return this.relay.processDue();
  }
}
