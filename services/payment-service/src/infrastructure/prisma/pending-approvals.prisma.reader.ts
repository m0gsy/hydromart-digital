import { Injectable } from '@nestjs/common';

import { RefundApproval } from '../../domain/payment';
import {
  PendingApprovalsReader,
  PendingSummary,
} from '../../application/ports/pending-approvals.reader';
import { PrismaService } from './prisma.service';

@Injectable()
export class PendingApprovalsPrismaReader implements PendingApprovalsReader {
  constructor(private readonly prisma: PrismaService) {}

  async refunds(notRequestedBy: string | null): Promise<PendingSummary> {
    const agg = await this.prisma.payment.aggregate({
      where: {
        refundApproval: RefundApproval.PENDING,
        // `not` alone would drop the rows with no requester recorded (SQL NULL <> x is NULL).
        ...(notRequestedBy
          ? { OR: [{ refundRequestedBy: null }, { refundRequestedBy: { not: notRequestedBy } }] }
          : {}),
      },
      _count: { _all: true },
      // No column records when a refund parked; the row's last write is that moment (or a
      // larger sum asked for later), which is also how the HQ queue orders itself.
      _min: { updatedAt: true },
    });
    return { count: agg._count._all, oldestAt: agg._min.updatedAt };
  }
}
