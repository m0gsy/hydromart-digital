import { Injectable } from '@nestjs/common';

import { MembershipTier } from '../../domain/membership';
import { PointsTxnType } from '../../domain/points';
import {
  AccountMutation,
  EarnMutation,
  ExpiryMutation,
  LoyaltyAccountRecord,
  LoyaltyRepository,
  PointsTransactionRecord,
} from '../../application/ports/loyalty.repository';
import {
  MembershipTier as PrismaTier,
  PointsTxnType as PrismaTxnType,
} from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

// Prisma generates enums that are structurally distinct from the domain enums, so
// rows are typed with `string` fields and cast back to the domain enum here (infra
// layer only). Writes use the generated enum objects for input typing.
interface AccountRow {
  id: string;
  customerId: string;
  tier: string;
  pointsBalance: number;
  lifetimePoints: number;
  createdAt: Date;
  updatedAt: Date;
}

interface TxnRow {
  id: string;
  customerId: string;
  type: string;
  points: number;
  orderId: string | null;
  reason: string | null;
  expiresAt: Date | null;
  expired: boolean;
  createdAt: Date;
}

@Injectable()
export class LoyaltyPrismaRepository implements LoyaltyRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toAccount(row: AccountRow): LoyaltyAccountRecord {
    return { ...row, tier: row.tier as MembershipTier };
  }

  private toTxn(row: TxnRow): PointsTransactionRecord {
    return { ...row, type: row.type as PointsTxnType };
  }

  async findAccount(customerId: string): Promise<LoyaltyAccountRecord | null> {
    const row = await this.prisma.loyaltyAccount.findUnique({ where: { customerId } });
    return row ? this.toAccount(row) : null;
  }

  async createAccount(customerId: string): Promise<LoyaltyAccountRecord> {
    const row = await this.prisma.loyaltyAccount.create({ data: { customerId } });
    return this.toAccount(row);
  }

  async findEarnByOrder(orderId: string): Promise<PointsTransactionRecord | null> {
    const row = await this.prisma.pointsTransaction.findUnique({
      where: { orderId_type: { orderId, type: PrismaTxnType.EARN } },
    });
    return row ? this.toTxn(row) : null;
  }

  async recordEarn(m: EarnMutation): Promise<LoyaltyAccountRecord> {
    const [, account] = await this.prisma.$transaction([
      this.prisma.pointsTransaction.create({
        data: {
          accountId: m.accountId,
          customerId: m.customerId,
          type: PrismaTxnType.EARN,
          points: m.points,
          orderId: m.orderId,
          reason: m.reason,
          expiresAt: m.expiresAt,
        },
      }),
      this.prisma.loyaltyAccount.update({
        where: { id: m.accountId },
        data: {
          pointsBalance: m.newBalance,
          lifetimePoints: m.newLifetime,
          tier: m.newTier as PrismaTier,
        },
      }),
    ]);
    return this.toAccount(account);
  }

  async recordAdjustment(m: AccountMutation & { type: PointsTxnType }): Promise<LoyaltyAccountRecord> {
    const [, account] = await this.prisma.$transaction([
      this.prisma.pointsTransaction.create({
        data: {
          accountId: m.accountId,
          customerId: m.customerId,
          type: PrismaTxnType.ADJUST,
          points: m.points,
          reason: m.reason,
        },
      }),
      this.prisma.loyaltyAccount.update({
        where: { id: m.accountId },
        data: {
          pointsBalance: m.newBalance,
          lifetimePoints: m.newLifetime,
          tier: m.newTier as PrismaTier,
        },
      }),
    ]);
    return this.toAccount(account);
  }

  async listTransactions(
    customerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: PointsTransactionRecord[]; total: number }> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.pointsTransaction.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pointsTransaction.count({ where: { customerId } }),
    ]);
    return { items: rows.map((r) => this.toTxn(r)), total };
  }

  async findExpirableLots(now: Date, limit: number): Promise<PointsTransactionRecord[]> {
    const rows = await this.prisma.pointsTransaction.findMany({
      where: { type: PrismaTxnType.EARN, expired: false, expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toTxn(r));
  }

  async recordExpiry(m: ExpiryMutation): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.pointsTransaction.update({
        where: { id: m.lotId },
        data: { expired: true },
      }),
      this.prisma.pointsTransaction.create({
        data: {
          accountId: m.accountId,
          customerId: m.customerId,
          type: PrismaTxnType.EXPIRE,
          points: -m.points,
          reason: 'Points expired',
        },
      }),
      this.prisma.loyaltyAccount.update({
        where: { id: m.accountId },
        data: { pointsBalance: m.newBalance },
      }),
    ]);
  }
}
