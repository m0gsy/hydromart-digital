import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { can } from '@hydromart/access';
import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  PendingApprovalsReader,
  PendingSummary,
} from '../application/ports/pending-approvals.reader';
import { DELIVERY_TOKENS } from '../application/tokens';
import { PendingSummaryQueryDto } from './dto/pending-approvals.dto';

/**
 * HD-11: dashboard-service asks, for one person, how many courier cash deposits wait for their
 * decision. Internal key only; the gateway strips that key, so this is never reachable from
 * outside. The depots are the person's own, as the caller resolved them from their token.
 */
@ApiTags('Pending approvals (internal)')
@Controller({ path: 'pending-approvals/internal', version: '1' })
export class PendingApprovalsController {
  constructor(
    @Inject(DELIVERY_TOKENS.PendingApprovalsReader) private readonly reader: PendingApprovalsReader,
  ) {}

  @ApiOkResponse({ description: '{ count, oldestAt }: SUBMITTED courier settlements' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('settlements')
  @ApiOperation({ summary: "Courier cash deposits waiting for this person's decision (internal)" })
  settlements(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    // `pendingCharge` asks the same question: a raised charge is signed under `approvals`.
    const chargeApprover = can('approvals', query.role) ? query.actorId : null;
    return this.reader.settlements(query.depotIds, chargeApprover);
  }
}
