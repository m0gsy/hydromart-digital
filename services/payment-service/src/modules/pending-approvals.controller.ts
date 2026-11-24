import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  PendingApprovalsReader,
  PendingSummary,
} from '../application/ports/pending-approvals.reader';
import { PAYMENT_TOKENS } from '../application/tokens';
import { PendingSummaryQueryDto } from './dto/pending-approvals.dto';

/**
 * HD-11: dashboard-service asks, for one person, how many refunds wait for their decision.
 * Internal key only; the gateway strips that key, so this is never reachable from outside.
 */
@ApiTags('Pending approvals (internal)')
@Controller({ path: 'pending-approvals/internal', version: '1' })
export class PendingApprovalsController {
  constructor(
    @Inject(PAYMENT_TOKENS.PendingApprovalsReader) private readonly reader: PendingApprovalsReader,
  ) {}

  @ApiOkResponse({ description: '{ count, oldestAt }: refunds parked above the HQ threshold' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('refunds')
  @ApiOperation({ summary: "Refunds waiting for this person's decision (internal)" })
  refunds(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    // PPA-04, as `approveRefund` applies it: whoever raised a refund does not release it, the
    // superuser excepted. No depot filter: the queue is network-wide and so is deciding it.
    return this.reader.refunds(query.role === 'SUPER_ADMIN' ? null : query.actorId);
  }
}
