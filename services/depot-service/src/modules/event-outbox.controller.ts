import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  EventRelayService,
  EventRelaySweepResult,
} from '../application/services/event-relay.service';

/** What one sweep did. `ok` is false when there was work and none of it got through. */
export class EventOutboxSweepDto implements EventRelaySweepResult {
  @ApiProperty() claimed!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ description: 'Rows that ran out of retries on this pass.' }) dead!: number;
  @ApiProperty({ description: 'DONE rows past the 7-day window, deleted.' }) pruned!: number;
  @ApiProperty() ok!: boolean;
}

/**
 * HD-7: the scheduler's entry point for re-sending webhook events admin-service has not taken
 * (scripts/scheduler/crontab). Not `webhook-outbox/...`: delivery-service owns that job name,
 * and the sweep lock and the /hq/health row are keyed on the path alone.
 */
@ApiTags('Event outbox (internal)')
@Controller({ path: 'event-outbox', version: '1' })
export class EventOutboxController {
  constructor(private readonly relay: EventRelayService) {}

  @ApiOkResponse({ type: EventOutboxSweepDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-send every webhook event still owed to admin-service (scheduler)' })
  process(): Promise<EventRelaySweepResult> {
    return this.relay.processDue();
  }
}
