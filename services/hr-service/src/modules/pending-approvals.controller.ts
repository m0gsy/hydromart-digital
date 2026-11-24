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

  @ApiOkResponse({ description: '{ count, oldestAt }: leave applications at each stage this person decides' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('leave')
  @ApiOperation({ summary: "Leave applications waiting for this person's decision (internal)" })
  async leave(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    // Both stages, as far as the person may decide them: stage 1 is the manager-decision route
    // (leaveApprove), stage 2 the hr-decision route (hrAdmin). HR holds both, so both count for
    // HR; a depot-level GRANT or DENY is read per depot, as RolesGuard reads it.
    const me = await this.employees.findByAuthSubjectId(query.actorId);
    const stages = [
      { status: 'PENDING_MANAGER', capability: 'leaveApprove', stageOneSigner: null },
      { status: 'PENDING_HR', capability: 'hrAdmin', stageOneSigner: query.actorId },
    ] as const;
    const parts = await Promise.all(
      stages.map(async (stage) => {
        const depotIds = query.depotIds
          ? query.depotIds.filter((d) => can(stage.capability, query.role, [d]))
          : undefined;
        // No depot given: only a person holding the capability network-wide decides this stage.
        if (depotIds ? depotIds.length === 0 : !can(stage.capability, query.role)) return null;
        return this.reader.leave({
          status: stage.status,
          depotIds,
          notEmployeeId: me?.id ?? null,
          notManagerDecidedBy: stage.stageOneSigner,
        });
      }),
    );
    return parts.reduce<PendingSummary>(
      (sum, part) => ({
        count: sum.count + (part?.count ?? 0),
        oldestAt: part?.oldestAt && (!sum.oldestAt || part.oldestAt < sum.oldestAt) ? part.oldestAt : sum.oldestAt,
      }),
      { count: 0, oldestAt: null },
    );
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
