import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  PendingApprovals,
  PendingApprovalsService,
} from '../application/services/pending-approvals.service';
import { PendingApprovalsResponseDto, PendingForAccountQueryDto } from './dto/pending-approvals.dto';

/**
 * AI-9: crm-service asks, for one named account, what HD-11 answers for that person, to write
 * their morning summary. Internal key only; the gateway strips that key, so none of this is
 * reachable from outside. The queue rules are PendingApprovalsService's, not a copy of them.
 */
@ApiTags('Dashboard')
@Controller({ path: 'dashboard/internal', version: '1' })
export class PendingApprovalsInternalController {
  constructor(private readonly pending: PendingApprovalsService) {}

  @ApiOkResponse({ type: PendingApprovalsResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('pending-approvals')
  @ApiOperation({ summary: "One account's pending approvals, per queue they decide (internal)" })
  forAccount(@Query() query: PendingForAccountQueryDto): Promise<PendingApprovals> {
    return this.pending.forAccount(query.accountId, query.role);
  }
}
