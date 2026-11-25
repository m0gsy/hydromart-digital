import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { AiReferralRepository, ReferralTotals } from '../../application/ports/ai-referral.repository';
import { PrismaService } from './prisma.service';

/** Most distinct referrers one answer will group. Past it the answer is refused (422), never a partial count. */
export const AI_REFERRER_CAP = 50_000;

/** HD-6 H4 part 2: plain Prisma reads, on the (createdAt) and (status, qualifiedAt) indexes. */
@Injectable()
export class AiReferralPrismaRepository implements AiReferralRepository {
  constructor(private readonly prisma: PrismaService) {}

  async totals(from: Date, to: Date): Promise<ReferralTotals> {
    // refereeCustomerId is unique, so referral rows ARE distinct referees (invited, qualified); the referrers are the groups.
    const [invited, perReferrer] = await Promise.all([
      this.prisma.referral.count({ where: { createdAt: { gte: from, lt: to } } }),
      this.prisma.referral.groupBy({
        by: ['referrerCustomerId'],
        where: { status: 'QUALIFIED', qualifiedAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: { referrerPoints: true, refereePoints: true },
        orderBy: { referrerCustomerId: 'asc' },
        take: AI_REFERRER_CAP + 1,
      }),
    ]);
    if (perReferrer.length > AI_REFERRER_CAP) {
      throw new UnprocessableEntityException(`Lebih dari ${AI_REFERRER_CAP} pengajak; persempit periode.`);
    }
    return {
      invited,
      qualified: perReferrer.reduce((n, r) => n + r._count._all, 0),
      qualifiedReferrers: perReferrer.length,
      referrerPoints: perReferrer.reduce((n, r) => n + (r._sum.referrerPoints ?? 0), 0),
      refereePoints: perReferrer.reduce((n, r) => n + (r._sum.refereePoints ?? 0), 0),
    };
  }
}
