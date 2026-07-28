import { Injectable } from '@nestjs/common';

import {
  CancelRedemptionMutation,
  CreateRewardItemData,
  RedeemMutation,
  RedemptionStatus,
  RewardItemRecord,
  RewardRedemptionRecord,
  RewardRedemptionView,
  RewardRepository,
  UpdateRewardItemData,
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

  async listAllItems(): Promise<RewardItemRecord[]> {
    return this.prisma.rewardItem.findMany({
      orderBy: [{ active: 'desc' }, { pointsCost: 'asc' }],
    });
  }

  async findItem(id: string): Promise<RewardItemRecord | null> {
    return this.prisma.rewardItem.findUnique({ where: { id } });
  }

  async createItem(data: CreateRewardItemData): Promise<RewardItemRecord> {
    return this.prisma.rewardItem.create({ data });
  }

  async updateItem(id: string, data: UpdateRewardItemData): Promise<RewardItemRecord> {
    return this.prisma.rewardItem.update({ where: { id }, data });
  }

  async findRedemptionByKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<RewardRedemptionRecord | null> {
    const row = await this.prisma.rewardRedemption.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
    });
    return row ? this.toRecord(row) : null;
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
    return this.toRecord(redemption);
  }

  async findRedemption(id: string): Promise<RewardRedemptionRecord | null> {
    const row = await this.prisma.rewardRedemption.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async listRedemptionsByCustomer(customerId: string): Promise<RewardRedemptionView[]> {
    const rows = await this.prisma.rewardRedemption.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { reward: { select: { name: true } } },
    });
    return rows.map((row) => this.toView(row));
  }

  async listRedemptionsByStatus(status: RedemptionStatus): Promise<RewardRedemptionView[]> {
    const rows = await this.prisma.rewardRedemption.findMany({
      where: { status },
      // Oldest first: the customer who has been waiting longest is served first.
      orderBy: { createdAt: 'asc' },
      include: { reward: { select: { name: true } } },
    });
    return rows.map((row) => this.toView(row));
  }

  async markUsed(id: string): Promise<RewardRedemptionRecord> {
    const row = await this.prisma.rewardRedemption.update({
      where: { id },
      data: { status: 'USED', usedAt: new Date() },
    });
    return this.toRecord(row);
  }

  /**
   * M14-03: one transaction, so a crash can never leave the redemption cancelled with
   * the points still gone (or refunded twice). The status guard in the WHERE clause is
   * the real defence against a double refund from two concurrent requests.
   */
  async cancel(m: CancelRedemptionMutation): Promise<RewardRedemptionRecord> {
    const [redemption] = await this.prisma.$transaction([
      this.prisma.rewardRedemption.update({
        where: { id: m.redemptionId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      }),
      // Positive ledger entry mirroring the REDEEM debit — lifetimePoints/tier stay put,
      // exactly as they did when the points were spent.
      this.prisma.pointsTransaction.create({
        data: {
          accountId: m.accountId,
          customerId: m.customerId,
          type: PrismaTxnType.REDEEM,
          points: m.pointsRefunded,
          reason: m.reason,
        },
      }),
      this.prisma.loyaltyAccount.update({
        where: { id: m.accountId },
        data: { pointsBalance: m.newBalance },
      }),
      ...(m.restoreStock
        ? [
            this.prisma.rewardItem.update({
              where: { id: m.rewardItemId },
              data: { stock: { increment: 1 } },
            }),
          ]
        : []),
    ]);
    return this.toRecord(redemption);
  }

  /** `reward` is the join handle, not part of the record — take the name and drop it. */
  private toView(
    row: Parameters<typeof this.toRecord>[0] & { reward: { name: string } },
  ): RewardRedemptionView {
    const { reward, ...rest } = row;
    return { ...this.toRecord(rest), rewardName: reward.name };
  }

  private toRecord(row: {
    id: string;
    rewardItemId: string;
    customerId: string;
    pointsSpent: number;
    status: string;
    usedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
  }): RewardRedemptionRecord {
    return { ...row, status: row.status as RewardRedemptionRecord['status'] };
  }
}
