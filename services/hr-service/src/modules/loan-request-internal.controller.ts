import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { LoanRequestService } from '../application/services/loan-request.service';

/**
 * HR-15: the scheduler's half of the kasbon requests. Its own file (and class) so the route reads as
 * `loan-requests/internal/...` exactly, beside - not inside - the `loan-requests/me` self controller.
 */
@ApiTags('HR Kasbon')
@Controller({ path: 'loan-requests', version: '1' })
export class LoanRequestInternalController {
  constructor(private readonly requests: LoanRequestService) {}

  @ApiOkResponse({ description: '{ reopened } - approvals handed back to PENDING' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/reopen-orphaned')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen approved kasbon requests that have no loan (internal service auth)' })
  reopenOrphaned(): Promise<{ reopened: number }> {
    return this.requests.reopenOrphaned();
  }
}
