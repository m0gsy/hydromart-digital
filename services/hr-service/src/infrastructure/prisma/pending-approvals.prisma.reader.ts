import { Injectable } from '@nestjs/common';

import { depotWhere } from '@hydromart/platform';

import {
  LeavePendingFilter,
  PendingApprovalsReader,
  PendingSummary,
} from '../../application/ports/pending-approvals.reader';
import { PrismaService } from './prisma.service';

@Injectable()
export class PendingApprovalsPrismaReader implements PendingApprovalsReader {
  constructor(private readonly prisma: PrismaService) {}

  async leave(filter: LeavePendingFilter): Promise<PendingSummary> {
    const agg = await this.prisma.leaveRequest.aggregate({
      where: {
        status: filter.status,
        ...(filter.depotIds ? { depotId: depotWhere(filter.depotIds) } : {}),
        ...(filter.notEmployeeId ? { employeeId: { not: filter.notEmployeeId } } : {}),
        // `not` alone would drop rows with no stage-1 decider (SQL NULL <> x is NULL).
        ...(filter.notManagerDecidedBy
          ? {
              OR: [
                { managerDecidedBy: null },
                { managerDecidedBy: { not: filter.notManagerDecidedBy } },
              ],
            }
          : {}),
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    return { count: agg._count._all, oldestAt: agg._min.createdAt };
  }
}
