import { Injectable } from '@nestjs/common';

import {
  PendingApprovalsReader,
  PendingSummary,
} from '../../application/ports/pending-approvals.reader';
import { PrismaService } from './prisma.service';

@Injectable()
export class PendingApprovalsPrismaReader implements PendingApprovalsReader {
  constructor(private readonly prisma: PrismaService) {}

  async expenses(
    depotIds: readonly string[] | undefined,
    maxAmountIdr: number | null,
  ): Promise<PendingSummary> {
    const agg = await this.prisma.expenseClaim.aggregate({
      where: {
        status: 'PENDING',
        ...(depotIds ? { depotId: { in: [...depotIds] } } : {}),
        ...(maxAmountIdr === null ? {} : { amount: { lte: maxAmountIdr } }),
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    return { count: agg._count._all, oldestAt: agg._min.createdAt };
  }
}
