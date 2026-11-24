import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  PendingApprovalsReader,
  PendingSummary,
} from '../application/ports/pending-approvals.reader';
import { PAYOUT_TOKENS } from '../application/tokens';
import { PendingSummaryQueryDto } from './dto/pending-approvals.dto';

/**
 * HD-11: dashboard-service asks, for one person, how many courier expense claims wait for their
 * decision. Internal key only; the gateway strips that key, so this is never reachable from
 * outside. The depots are the person's own, as the caller resolved them from their token.
 */
@ApiTags('Pending approvals (internal)')
@Controller({ path: 'pending-approvals/internal', version: '1' })
export class PendingApprovalsController {
  constructor(
    @Inject(PAYOUT_TOKENS.PendingApprovalsReader) private readonly reader: PendingApprovalsReader,
  ) {}

  @ApiOkResponse({ description: '{ count, oldestAt }: PENDING courier expense claims' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('expenses')
  @ApiOperation({ summary: "Courier expense claims waiting for this person's decision (internal)" })
  expenses(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    // PYO-5: above the manager's ceiling a manager cannot approve, but can still reject (`reject`
    // has no ceiling), so every PENDING claim waits for their decision, and for finance's.
    return this.reader.expenses(query.depotIds);
  }
}
