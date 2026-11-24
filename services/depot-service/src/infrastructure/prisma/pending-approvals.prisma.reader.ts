import { Injectable } from '@nestjs/common';

import { ApprovalStatus } from '../../domain/approval';
import { FranchiseAppStage } from '../../domain/franchise-application';
import { PriceOverrideStatus } from '../../domain/price-override-proposal';
import {
  PendingApprovalsReader,
  PendingSummary,
} from '../../application/ports/pending-approvals.reader';
import { PrismaService } from './prisma.service';

const depotFilter = (depotIds: readonly string[] | undefined) =>
  depotIds ? { depotId: { in: [...depotIds] } } : {};

/** One aggregate per queue: the count and the oldest timestamp, read together. */
@Injectable()
export class PendingApprovalsPrismaReader implements PendingApprovalsReader {
  constructor(private readonly prisma: PrismaService) {}

  async priceOverrides(depotIds: readonly string[] | undefined): Promise<PendingSummary> {
    const agg = await this.prisma.priceOverrideProposal.aggregate({
      where: { status: PriceOverrideStatus.PENDING, ...depotFilter(depotIds) },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    return { count: agg._count._all, oldestAt: agg._min.createdAt };
  }

  async franchiseApplications(): Promise<PendingSummary> {
    const agg = await this.prisma.franchiseApplication.aggregate({
      where: { stage: { notIn: [FranchiseAppStage.APPROVED, FranchiseAppStage.REJECTED] } },
      _count: { _all: true },
      _min: { submittedAt: true },
    });
    return { count: agg._count._all, oldestAt: agg._min.submittedAt };
  }

  async approvals(
    depotIds: readonly string[] | undefined,
    notSubmittedBy: string,
  ): Promise<PendingSummary> {
    const agg = await this.prisma.approval.aggregate({
      where: {
        // A held item is still waiting on someone (the approvals screen lists both).
        status: { in: [ApprovalStatus.PENDING, ApprovalStatus.HELD] },
        ...depotFilter(depotIds),
        // CA-2-20: nobody decides an item they raised, so it never waits on them.
        submittedBy: { not: notSubmittedBy },
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    return { count: agg._count._all, oldestAt: agg._min.createdAt };
  }
}
