import { Injectable } from '@nestjs/common';

import { InvalidAdjustmentError } from '../../domain/errors';
import { MembershipTier } from '../../domain/membership';
import { PointsTxnType } from '../../domain/points';
import {
  AccountMutation,
  EarnMutation,
  ExpiryMutation,
  LoyaltyAccountRecord,
  LoyaltyRepository,
  PointsTransactionRecord,
  zeroTierCounts,
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

/**
 * Turns "the WHERE matched no row" into the caller's answer (H-2).
 *
 * On these writes P2025 only ever means the `pointsBalance >= …` floor rejected a debit —
 * someone else spent the points between the service's read and this write. Left raw it
 * would surface as a 500 on an ordinary race.
 */
function rejectOnMissingRow(error: unknown): never {
  if ((error as { code?: string })?.code === 'P2025') {
    throw new InvalidAdjustmentError();
  }
  throw error;
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
    // Two first-ever movements for one customer race here, and `customerId` is unique.
    // The loser reads back the winner's account instead of surfacing a P2002 as a 500 —
    // an account is a lazily-created container, not something a caller can conflict over.
    const row = await this.prisma.loyaltyAccount
      .upsert({ where: { customerId }, create: { customerId }, update: {} })
      .catch(async (error: unknown) => {
        if ((error as { code?: string })?.code !== 'P2002') throw error;
        return this.prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId } });
      });
    return this.toAccount(row);
  }

  async countAccounts(): Promise<number> {
    return this.prisma.loyaltyAccount.count();
  }

  async countByTier(customerIds: string[]): Promise<Record<MembershipTier, number>> {
    const counts = zeroTierCounts();
    if (customerIds.length === 0) return counts;
    const rows = await this.prisma.loyaltyAccount.groupBy({
      by: ['tier'],
      where: { customerId: { in: customerIds } },
      _count: { _all: true },
    });
    for (const row of rows) counts[row.tier as MembershipTier] = row._count._all;
    return counts;
  }

  async sumPointsBalance(customerIds: string[]): Promise<number> {
    if (customerIds.length === 0) return 0;
    const agg = await this.prisma.loyaltyAccount.aggregate({
      where: { customerId: { in: customerIds } },
      _sum: { pointsBalance: true },
    });
    return agg._sum.pointsBalance ?? 0;
  }

  async sumRedeemedSince(customerIds: string[], since: Date): Promise<number> {
    if (customerIds.length === 0) return 0;
    const agg = await this.prisma.rewardRedemption.aggregate({
      where: { customerId: { in: customerIds }, createdAt: { gte: since } },
      _sum: { pointsSpent: true },
    });
    return agg._sum.pointsSpent ?? 0;
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
          pointsBalance: { increment: m.points },
          lifetimePoints: { increment: m.lifetimeDelta },
        },
      }),
    ]);
    return this.toAccount(account);
  }

  async recordAdjustment(
    m: AccountMutation & { type: PointsTxnType },
  ): Promise<LoyaltyAccountRecord> {
    // P2025 here means the balance floor in the WHERE below rejected the debit — someone
    // else spent the points between the service's read and this write. It is the caller's
    // answer, not a server fault, so it must not surface as a 500.
    const [, account] = await this.prisma
      .$transaction([
        this.prisma.pointsTransaction.create({
          data: {
            accountId: m.accountId,
            customerId: m.customerId,
            type: PrismaTxnType[m.type],
            points: m.points,
            reason: m.reason,
          },
        }),
        // The balance floor lives in the WHERE clause: a debit that the account cannot cover
        // matches no row, Prisma raises P2025, and the whole transaction — ledger entry
        // included — rolls back. A pre-read cannot do this; two of them both saw enough.
        this.prisma.loyaltyAccount.update({
          where:
            m.points < 0
              ? { id: m.accountId, pointsBalance: { gte: -m.points } }
              : { id: m.accountId },
          data: {
            pointsBalance: { increment: m.points },
            lifetimePoints: { increment: m.lifetimeDelta },
          },
        }),
      ])
      .catch(rejectOnMissingRow);
    return this.toAccount(account);
  }

  async setTier(accountId: string, tier: MembershipTier): Promise<LoyaltyAccountRecord> {
    const account = await this.prisma.loyaltyAccount.update({
      where: { id: accountId },
      data: { tier: tier as PrismaTier },
    });
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
      // GREATEST, not a pre-read clamp: the sweep runs against whatever the balance is at
      // the moment it lands, and an expired lot larger than the remaining balance must
      // empty the account, not drive it negative.
      this.prisma.$executeRaw`
        UPDATE "loyalty_accounts"
           SET "pointsBalance" = GREATEST(0, "pointsBalance" - ${m.points}),
               "updatedAt" = NOW()
         WHERE "id" = ${m.accountId}
      `,
    ]);
  }
}
