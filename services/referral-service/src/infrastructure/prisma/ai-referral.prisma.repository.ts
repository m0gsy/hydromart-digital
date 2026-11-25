import { Injectable } from '@nestjs/common';

import { AiReferralRepository, ReferralTotals } from '../../application/ports/ai-referral.repository';
import { PrismaService } from './prisma.service';

/** HD-6 H4 part 2: plain Prisma reads, on the (createdAt) and (status, qualifiedAt) indexes. */
@Injectable()
export class AiReferralPrismaRepository implements AiReferralRepository {
  constructor(private readonly prisma: PrismaService) {}

  async totals(from: Date, to: Date): Promise<ReferralTotals> {
    const [invited, qualified] = await Promise.all([
      this.prisma.referral.count({ where: { createdAt: { gte: from, lt: to } } }),
      this.prisma.referral.aggregate({
        where: { status: 'QUALIFIED', qualifiedAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: { referrerPoints: true, refereePoints: true },
      }),
    ]);
    return {
      invited,
      qualified: qualified._count._all,
      referrerPoints: qualified._sum.referrerPoints ?? 0,
      refereePoints: qualified._sum.refereePoints ?? 0,
    };
  }
}
