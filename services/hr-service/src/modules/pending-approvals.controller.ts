import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { can } from '@hydromart/access';
import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  PENDING_APPROVALS_READER,
  PendingApprovalsReader,
  PendingSummary,
} from '../application/ports/pending-approvals.reader';
import { EmployeeService } from '../application/services/employee.service';
import { LoanRequestService } from '../application/services/loan-request.service';
import { PendingSummaryQueryDto } from './dto/pending-approvals.dto';

/**
 * HD-11: dashboard-service asks, for one person, how many leave applications and kasbon
 * requests wait for their decision. Internal key only; the gateway strips that key, so none of
 * this is reachable from outside. The depots are the person's own, as the caller resolved them.
 */
@ApiTags('Pending approvals (internal)')
@Controller({ path: 'pending-approvals/internal', version: '1' })
export class PendingApprovalsController {
  constructor(
    @Inject(PENDING_APPROVALS_READER) private readonly reader: PendingApprovalsReader,
    private readonly employees: EmployeeService,
    private readonly loanRequests: LoanRequestService,
  ) {}

  @ApiOkResponse({ description: '{ count, oldestAt }: leave applications at the stage this person decides' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('leave')
  @ApiOperation({ summary: "Leave applications waiting for this person's decision (internal)" })
  async leave(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    // The approvals screen's own default: whoever holds stage 2 (hrAdmin) reads stage 2; a
    // manager reads stage 1. HR holds stage 1 too, only so a depot without a manager is not stuck.
    const status = can('hrAdmin', query.role) ? 'PENDING_HR' : 'PENDING_MANAGER';
    const me = await this.employees.findByAuthSubjectId(query.actorId);
    return this.reader.leave({
      status,
      depotIds: query.depotIds,
      notEmployeeId: me?.id ?? null,
      notManagerDecidedBy: status === 'PENDING_HR' ? query.actorId : null,
    });
  }

  @ApiOkResponse({ description: '{ count, oldestAt }: PENDING kasbon this person may decide (K1/K2)' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('kasbon')
  @ApiOperation({ summary: "Kasbon requests waiting for this person's decision (internal)" })
  kasbon(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    return this.loanRequests.decidableSummary(query.actorId, query.depotIds);
  }
}
