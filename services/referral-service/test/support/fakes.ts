import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { ReferralConfigService } from '../../src/config/referral-config.service';
import { ReferralStatus } from '../../src/domain/referral-status';
import { CustomerDirectoryPort } from '../../src/application/ports/customer-directory.port';
import { LoyaltyRewardPort } from '../../src/application/ports/loyalty-reward.port';
import { SettingsRepository } from '../../src/application/ports/settings.repository';
import {
  CreateReferralData,
  ReferralCodeRecord,
  ReferralRecord,
  ReferralRepository,
  TopReferrer,
} from '../../src/application/ports/referral.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryReferralRepository implements ReferralRepository {
  codes: ReferralCodeRecord[] = [];
  referrals: ReferralRecord[] = [];

  async findCodeByCustomer(customerId: string): Promise<ReferralCodeRecord | null> {
    const c = this.codes.find((x) => x.customerId === customerId);
    return c ? { ...c } : null;
  }

  async createCode(customerId: string, code: string): Promise<ReferralCodeRecord> {
    if (this.codes.some((x) => x.customerId === customerId || x.code === code)) {
      throw new Error('unique constraint');
    }
    const record: ReferralCodeRecord = { id: randomUUID(), customerId, code, createdAt: nextDate() };
    this.codes.push(record);
    return { ...record };
  }

  async findCodeByCode(code: string): Promise<ReferralCodeRecord | null> {
    const c = this.codes.find((x) => x.code === code);
    return c ? { ...c } : null;
  }

  async findReferralByReferee(refereeCustomerId: string): Promise<ReferralRecord | null> {
    const r = this.referrals.find((x) => x.refereeCustomerId === refereeCustomerId);
    return r ? { ...r } : null;
  }

  async createReferral(data: CreateReferralData): Promise<ReferralRecord> {
    if (this.referrals.some((x) => x.refereeCustomerId === data.refereeCustomerId)) {
      throw new Error('unique constraint');
    }
    const now = nextDate();
    const record: ReferralRecord = {
      id: randomUUID(),
      referrerCustomerId: data.referrerCustomerId,
      refereeCustomerId: data.refereeCustomerId,
      code: data.code,
      status: ReferralStatus.PENDING,
      qualifyingOrderId: null,
      referrerPoints: 0,
      refereePoints: 0,
      qualifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.referrals.push(record);
    return { ...record };
  }

  async listReferralsByReferrer(
    referrerCustomerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ReferralRecord[]; total: number }> {
    const all = this.referrals
      .filter((r) => r.referrerCustomerId === referrerCustomerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit).map((r) => ({ ...r })), total: all.length };
  }

  async summarizeReferrer(
    referrerCustomerId: string,
  ): Promise<{ referredCount: number; qualifiedCount: number; pointsEarned: number }> {
    const mine = this.referrals.filter((r) => r.referrerCustomerId === referrerCustomerId);
    const qualified = mine.filter((r) => r.status === ReferralStatus.QUALIFIED);
    return {
      referredCount: mine.length,
      qualifiedCount: qualified.length,
      pointsEarned: qualified.reduce((sum, r) => sum + r.referrerPoints, 0),
    };
  }

  async countReferrals(referrerIds: string[]): Promise<number> {
    if (referrerIds.length === 0) return 0;
    return this.referrals.filter((r) => referrerIds.includes(r.referrerCustomerId)).length;
  }

  async countQualified(referrerIds: string[]): Promise<number> {
    if (referrerIds.length === 0) return 0;
    return this.qualifiedIn(referrerIds).length;
  }

  async sumReferrerPoints(referrerIds: string[]): Promise<number> {
    if (referrerIds.length === 0) return 0;
    return this.qualifiedIn(referrerIds).reduce((sum, r) => sum + r.referrerPoints, 0);
  }

  async topReferrers(referrerIds: string[], limit = 5): Promise<TopReferrer[]> {
    if (referrerIds.length === 0) return [];
    const byReferrer = new Map<string, TopReferrer>();
    for (const r of this.qualifiedIn(referrerIds)) {
      const row = byReferrer.get(r.referrerCustomerId) ?? {
        customerId: r.referrerCustomerId,
        referralCount: 0,
        pointsEarned: 0,
      };
      row.referralCount += 1;
      row.pointsEarned += r.referrerPoints;
      byReferrer.set(r.referrerCustomerId, row);
    }
    return [...byReferrer.values()]
      .sort((a, b) => b.referralCount - a.referralCount)
      .slice(0, limit);
  }

  private qualifiedIn(referrerIds: string[]): ReferralRecord[] {
    return this.referrals.filter(
      (r) => referrerIds.includes(r.referrerCustomerId) && r.status === ReferralStatus.QUALIFIED,
    );
  }

  async qualifyReferral(
    referralId: string,
    qualifyingOrderId: string,
    referrerPoints: number,
    refereePoints: number,
  ): Promise<ReferralRecord | null> {
    const r = this.referrals.find((x) => x.id === referralId);
    if (!r || r.status !== ReferralStatus.PENDING) return null;
    r.status = ReferralStatus.QUALIFIED;
    r.qualifyingOrderId = qualifyingOrderId;
    r.referrerPoints = referrerPoints;
    r.refereePoints = refereePoints;
    r.qualifiedAt = nextDate();
    r.updatedAt = nextDate();
    return { ...r };
  }
}

export interface RewardCall {
  customerId: string;
  points: number;
  reason: string;
  authorization: string;
}

export class FakeLoyaltyReward implements LoyaltyRewardPort {
  calls: RewardCall[] = [];
  shouldThrow = false;

  async reward(
    customerId: string,
    points: number,
    reason: string,
    authorization: string,
  ): Promise<void> {
    this.calls.push({ customerId, points, reason, authorization });
    if (this.shouldThrow) throw new Error('loyalty down');
  }
}

export class FakeCustomerDirectory implements CustomerDirectoryPort {
  constructor(private readonly idsByDepot: Record<string, string[]> = {}) {}

  async customerIdsForDepot(depotId: string): Promise<string[]> {
    return this.idsByDepot[depotId] ?? [];
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): ReferralConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    REFERRAL_SERVICE_PORT: '3011',
    REFERRAL_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    LOYALTY_SERVICE_URL: 'http://localhost:3009',
    REFERRAL_REFERRER_POINTS: '500',
    REFERRAL_REFEREE_POINTS: '250',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  // ponytail: empty-row cache — every business getter falls through to the env value
  // above, matching today's (pre-settings-cache) behavior exactly.
  return new ReferralConfigService(
    fake as unknown as ConfigService,
    new SettingsCache({ loadAll: async () => [] }),
  );
}

export class InMemorySettingsRepository implements SettingsRepository {
  rows: (SettingRow & { updatedBy: string })[] = [];

  async loadAll(): Promise<SettingRow[]> {
    return this.rows.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value }));
  }
  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key,
    );
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
  }
  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    const i = this.rows.findIndex((r) => r.scope === scope && r.depotId === depotId && r.key === key);
    if (i >= 0) this.rows.splice(i, 1);
  }
}
