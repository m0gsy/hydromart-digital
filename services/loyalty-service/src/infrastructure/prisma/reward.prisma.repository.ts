import { Injectable } from '@nestjs/common';

import {
  RedeemMutation,
  RewardItemRecord,
  RewardRedemptionRecord,
  RewardRepository,
} from '../../application/ports/reward.repository';
import { PointsTxnType as PrismaTxnType } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class RewardPrismaRepository implements RewardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveItems(): Promise<RewardItemRecord[]> {
    return this.prisma.rewardItem.findMany({
      where: { active: true },
      orderBy: { pointsCost: 'asc' },
    });
  }

  async findItem(id: string): Promise<RewardItemRecord | null> {
    return this.prisma.rewardItem.findUnique({ where: { id } });
  }

  async findRedemptionByKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<RewardRedemptionRecord | null> {
    return this.prisma.rewardRedemption.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
    });
  }

  async redeem(m: RedeemMutation): Promise<RewardRedemptionRecord> {
    const [redemption] = await this.prisma.$transaction([
      this.prisma.rewardRedemption.create({
        data: {
          rewardItemId: m.rewardItemId,
          customerId: m.customerId,
          pointsSpent: m.pointsSpent,
          idempotencyKey: m.idempotencyKey,
        },
      }),
      // Negative ledger entry — lifetimePoints/tier untouched (spend never promotes).
      this.prisma.pointsTransaction.create({
        data: {
          accountId: m.accountId,
          customerId: m.customerId,
          type: PrismaTxnType.REDEEM,
          points: -m.pointsSpent,
          reason: m.reason,
        },
      }),
      this.prisma.loyaltyAccount.update({
        where: { id: m.accountId },
        data: { pointsBalance: m.newBalance },
      }),
      ...(m.decrementStock
        ? [
            this.prisma.rewardItem.update({
              where: { id: m.rewardItemId },
              data: { stock: { decrement: 1 } },
            }),
          ]
        : []),
    ]);
    return redemption;
  }
}
