import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { LoyaltyConfigService } from '../../src/config/loyalty-config.service';
import { MembershipTier } from '../../src/domain/membership';
import { PointsTxnType } from '../../src/domain/points';
import {
  AccountMutation,
  EarnMutation,
  ExpiryMutation,
  LoyaltyAccountRecord,
  LoyaltyRepository,
  PointsTransactionRecord,
} from '../../src/application/ports/loyalty.repository';
import {
  RedeemMutation,
  RewardItemRecord,
  RewardRedemptionRecord,
  RewardRepository,
} from '../../src/application/ports/reward.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryLoyaltyRepository implements LoyaltyRepository {
  accounts: LoyaltyAccountRecord[] = [];
  txns: PointsTransactionRecord[] = [];

  async findAccount(customerId: string): Promise<LoyaltyAccountRecord | null> {
    const a = this.accounts.find((x) => x.customerId === customerId);
    return a ? { ...a } : null;
  }

  async createAccount(customerId: string): Promise<LoyaltyAccountRecord> {
    const now = nextDate();
    const a: LoyaltyAccountRecord = {
      id: randomUUID(),
      customerId,
      tier: MembershipTier.REGULAR,
      pointsBalance: 0,
      lifetimePoints: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.push(a);
    return { ...a };
  }

  async findEarnByOrder(orderId: string): Promise<PointsTransactionRecord | null> {
    const t = this.txns.find((x) => x.orderId === orderId && x.type === PointsTxnType.EARN);
    return t ? { ...t } : null;
  }

  private applyToAccount(m: AccountMutation): LoyaltyAccountRecord {
    const acc = this.accounts.find((x) => x.id === m.accountId)!;
    acc.pointsBalance = m.newBalance;
    acc.lifetimePoints = m.newLifetime;
    acc.tier = m.newTier;
    acc.updatedAt = nextDate();
    return { ...acc };
  }

  async recordEarn(m: EarnMutation): Promise<LoyaltyAccountRecord> {
    this.txns.push({
      id: randomUUID(),
      customerId: m.customerId,
      type: PointsTxnType.EARN,
      points: m.points,
      orderId: m.orderId,
      reason: m.reason,
      expiresAt: m.expiresAt,
      expired: false,
      createdAt: nextDate(),
    });
    return this.applyToAccount(m);
  }

  async recordAdjustment(m: AccountMutation & { type: PointsTxnType }): Promise<LoyaltyAccountRecord> {
    this.txns.push({
      id: randomUUID(),
      customerId: m.customerId,
      type: m.type,
      points: m.points,
      orderId: null,
      reason: m.reason,
      expiresAt: null,
      expired: false,
      createdAt: nextDate(),
    });
    return this.applyToAccount(m);
  }

  async listTransactions(
    customerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: PointsTransactionRecord[]; total: number }> {
    const all = this.txns
      .filter((t) => t.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit).map((t) => ({ ...t })), total: all.length };
  }

  async findExpirableLots(now: Date, limit: number): Promise<PointsTransactionRecord[]> {
    return this.txns
      .filter((t) => t.type === PointsTxnType.EARN && !t.expired && t.expiresAt !== null && t.expiresAt <= now)
      .sort((a, b) => (a.expiresAt!.getTime() - b.expiresAt!.getTime()))
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async recordExpiry(m: ExpiryMutation): Promise<void> {
    const lot = this.txns.find((t) => t.id === m.lotId)!;
    lot.expired = true;
    this.txns.push({
      id: randomUUID(),
      customerId: m.customerId,
      type: PointsTxnType.EXPIRE,
      points: -m.points,
      orderId: null,
      reason: 'Points expired',
      expiresAt: null,
      expired: false,
      createdAt: nextDate(),
    });
    const acc = this.accounts.find((x) => x.id === m.accountId)!;
    acc.pointsBalance = m.newBalance;
    acc.updatedAt = nextDate();
  }
}

export class InMemoryRewardRepository implements RewardRepository {
  items: RewardItemRecord[] = [];
  redemptions: RewardRedemptionRecord[] = [];

  // Shares the loyalty repo so a redeem applies the balance debit + REDEEM ledger
  // entry atomically alongside the loyalty account, mirroring the Prisma $transaction.
  constructor(private readonly loyalty: InMemoryLoyaltyRepository) {}

  seedItem(item: Partial<RewardItemRecord> & { id: string; pointsCost: number }): RewardItemRecord {
    const full: RewardItemRecord = {
      name: 'Reward',
      unit: 'unit',
      imageUrl: null,
      active: true,
      stock: null,
      ...item,
    };
    this.items.push(full);
    return full;
  }

  async listActiveItems(): Promise<RewardItemRecord[]> {
    return this.items.filter((i) => i.active).map((i) => ({ ...i }));
  }

  async findItem(id: string): Promise<RewardItemRecord | null> {
    const i = this.items.find((x) => x.id === id);
    return i ? { ...i } : null;
  }

  async findRedemptionByKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<RewardRedemptionRecord | null> {
    const r = this.redemptions.find(
      (x) => x.customerId === customerId && (x as { idempotencyKey?: string }).idempotencyKey === idempotencyKey,
    );
    return r ? { ...r } : null;
  }

  async redeem(m: RedeemMutation): Promise<RewardRedemptionRecord> {
    const redemption: RewardRedemptionRecord & { idempotencyKey: string } = {
      id: randomUUID(),
      rewardItemId: m.rewardItemId,
      customerId: m.customerId,
      pointsSpent: m.pointsSpent,
      idempotencyKey: m.idempotencyKey,
      createdAt: nextDate(),
    };
    this.redemptions.push(redemption);
    // Mirror the atomic write: negative REDEEM ledger entry + balance debit,
    // lifetimePoints untouched.
    this.loyalty.txns.push({
      id: randomUUID(),
      customerId: m.customerId,
      type: PointsTxnType.REDEEM,
      points: -m.pointsSpent,
      orderId: null,
      reason: m.reason,
      expiresAt: null,
      expired: false,
      createdAt: nextDate(),
    });
    const acc = this.loyalty.accounts.find((x) => x.id === m.accountId)!;
    acc.pointsBalance = m.newBalance;
    acc.updatedAt = nextDate();
    if (m.decrementStock) {
      const item = this.items.find((x) => x.id === m.rewardItemId)!;
      item.stock = (item.stock ?? 0) - 1;
    }
    return { ...redemption };
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): LoyaltyConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    LOYALTY_SERVICE_PORT: '3009',
    LOYALTY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    LOYALTY_EARN_RATE_RUPIAH: '1000',
    LOYALTY_POINT_EXPIRY_MONTHS: '12',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new LoyaltyConfigService(fake as unknown as ConfigService);
}
