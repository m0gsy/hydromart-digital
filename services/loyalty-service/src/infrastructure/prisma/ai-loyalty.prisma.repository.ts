import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import {
  AiLoyaltyRepository,
  AiSpan,
  PointsOutstanding,
  RedemptionTotals,
} from '../../application/ports/ai-loyalty.repository';
import { PrismaService } from './prisma.service';

/** Most distinct redeemers one answer will group. Past it the answer is refused (422), never a partial count. */
export const AI_REDEEMER_CAP = 50_000;

/** HD-6 H4 part 2: plain Prisma reads (no raw SQL), every date a real instant Prisma stores as UTC. */
@Injectable()
export class AiLoyaltyPrismaRepository implements AiLoyaltyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async redemptions(spans: readonly AiSpan[]): Promise<RedemptionTotals> {
    if (spans.length === 0) return { redemptions: 0, points: 0, redeemers: 0, unplaced: 0 };
    const inSpans = spans.map((s) => ({ depotId: s.depotId, usedAt: { gte: s.from, lt: s.to } }));
    const earliest = new Date(Math.min(...spans.map((s) => s.from.getTime())));
    const latest = new Date(Math.max(...spans.map((s) => s.to.getTime())));
    const [perPerson, unplaced] = await Promise.all([
      this.prisma.rewardRedemption.groupBy({
        by: ['customerId'],
        where: { status: 'USED', OR: inSpans },
        _count: { _all: true },
        _sum: { pointsSpent: true },
        orderBy: { customerId: 'asc' },
        take: AI_REDEEMER_CAP + 1,
      }),
      this.prisma.rewardRedemption.count({
        where: { status: 'USED', depotId: null, usedAt: { gte: earliest, lt: latest } },
      }),
    ]);
    if (perPerson.length > AI_REDEEMER_CAP) {
      throw new UnprocessableEntityException(`Lebih dari ${AI_REDEEMER_CAP} penukar; persempit depot atau periode.`);
    }
    return {
      redemptions: perPerson.reduce((n, r) => n + r._count._all, 0),
      points: perPerson.reduce((n, r) => n + (r._sum.pointsSpent ?? 0), 0),
      redeemers: perPerson.length,
      unplaced,
    };
  }

  async pointsOutstanding(before: Date): Promise<PointsOutstanding> {
    const [accounts, ledger] = await Promise.all([
      this.prisma.loyaltyAccount.count({ where: { createdAt: { lt: before } } }),
      this.prisma.pointsTransaction.aggregate({ where: { createdAt: { lt: before } }, _sum: { points: true } }),
    ]);
    return { accounts, points: ledger._sum.points ?? 0 };
  }
}
