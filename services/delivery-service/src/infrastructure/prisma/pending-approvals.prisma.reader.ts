import { Injectable } from '@nestjs/common';

import { SettlementStatus } from '../../domain/settlement';
import {
  PendingApprovalsReader,
  PendingSummary,
} from '../../application/ports/pending-approvals.reader';
import { PrismaService } from './prisma.service';

@Injectable()
export class PendingApprovalsPrismaReader implements PendingApprovalsReader {
  constructor(private readonly prisma: PrismaService) {}

  async settlements(
    depotIds: readonly string[] | undefined,
    chargeApprover: string | null,
  ): Promise<PendingSummary> {
    const agg = await this.prisma.cashSettlement.aggregate({
      where: {
        status: SettlementStatus.SUBMITTED,
        ...(depotIds ? { depotId: { in: [...depotIds] } } : {}),
        // No charge raised: any cashier may verify or dispute it. A raised charge waits for a
        // second person, never the one who raised it.
        OR: [
          { chargeRequestedBy: null },
          ...(chargeApprover ? [{ chargeRequestedBy: { not: chargeApprover } }] : []),
        ],
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    return { count: agg._count._all, oldestAt: agg._min.createdAt };
  }
}
