import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import {
  PendingApprovals,
  PendingApprovalsService,
} from '../application/services/pending-approvals.service';
import { PendingApprovalsResponseDto } from './dto/pending-approvals.dto';

/**
 * HD-11: "jumlah persetujuan yang menunggu" for the AI web's Command Center
 * (contracts/ai-v1/approvals.openapi.json). The person's own AI-web token; their own role and
 * depots decide what is counted. A hydromart-digital staff session gets the same answer, which
 * is harmless: it is what that person's own screens already show them. Machine tokens are not
 * let in.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller({ path: 'dashboard', version: '1' })
export class PendingApprovalsController {
  constructor(private readonly pending: PendingApprovalsService) {}

  @ApiOkResponse({ type: PendingApprovalsResponseDto })
  @ExternalAccess('ai')
  @Can('pendingApprovals')
  @Get('pending-approvals')
  @ApiOperation({ summary: 'How many items wait for my decision, per queue I decide' })
  pendingApprovals(@CurrentUser() user: AuthenticatedUser): Promise<PendingApprovals> {
    return this.pending.forCaller(user);
  }
}
