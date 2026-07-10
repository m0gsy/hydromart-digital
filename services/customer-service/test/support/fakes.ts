import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { CustomerConfigService } from '../../src/config/customer-config.service';
import { MembershipTier } from '../../src/domain/membership-tier.enum';
import {
  CustomerProfileRecord,
  DirectoryRecipient,
  ProfileRepository,
  SegmentFilter,
} from '../../src/application/ports/profile.repository';
import {
  AddressRecord,
  AddressRepository,
  CreateAddressData,
  UpdateAddressData,
} from '../../src/application/ports/address.repository';
import {
  NotificationPreferenceRecord,
  NotificationPreferenceRepository,
} from '../../src/application/ports/notification.repository';
import { LoyaltyRewardPort } from '../../src/application/ports/loyalty-reward.port';

let seq = 0;
// Monotonic createdAt so "most recent" ordering is deterministic in tests.
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryProfileRepository implements ProfileRepository {
  private rows = new Map<string, CustomerProfileRecord>();

  // Optional address source so findSegment (FR-087) can join to a primary address.
  constructor(private readonly addresses?: InMemoryAddressRepository) {}

  /** Test helper: force a tier (membershipTier is read-only via the API). */
  async setTier(customerId: string, tier: MembershipTier): Promise<void> {
    const rec = this.rows.get(customerId) ?? (await this.create(customerId));
    rec.membershipTier = tier;
  }

  async findByCustomerId(customerId: string): Promise<CustomerProfileRecord | null> {
    return this.rows.get(customerId) ?? null;
  }
  async create(customerId: string): Promise<CustomerProfileRecord> {
    const now = nextDate();
    const rec: CustomerProfileRecord = {
      customerId,
      membershipTier: MembershipTier.BASIC,
      pointBalance: 0,
      favoriteDepotId: null,
      birthdate: null,
      lastBirthdayRewardYear: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(customerId, rec);
    return rec;
  }
  async updateFavoriteDepot(customerId: string, favoriteDepotId: string | null) {
    const rec = this.rows.get(customerId)!;
    rec.favoriteDepotId = favoriteDepotId;
    rec.updatedAt = nextDate();
    return { ...rec };
  }
  async updateBirthdate(customerId: string, birthdate: Date | null) {
    const rec = this.rows.get(customerId)!;
    rec.birthdate = birthdate;
    rec.updatedAt = nextDate();
    return { ...rec };
  }
  async findBirthdayCandidates(month: number, day: number, year: number): Promise<string[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.birthdate !== null &&
          r.birthdate.getUTCMonth() + 1 === month &&
          r.birthdate.getUTCDate() === day &&
          r.lastBirthdayRewardYear !== year,
      )
      .map((r) => r.customerId);
  }
  async markBirthdayRewarded(customerId: string, year: number): Promise<void> {
    const rec = this.rows.get(customerId);
    if (rec) rec.lastBirthdayRewardYear = year;
  }

  async findSegment(filter: SegmentFilter): Promise<DirectoryRecipient[]> {
    const out: DirectoryRecipient[] = [];
    for (const p of this.rows.values()) {
      if (filter.tier && p.membershipTier !== filter.tier) continue;
      const addrs = this.addresses ? await this.addresses.listByCustomer(p.customerId) : [];
      const primary = addrs.find((a) => a.isPrimary);
      if (!primary) continue;
      if (filter.city && primary.city.toLowerCase() !== filter.city.toLowerCase()) continue;
      out.push({ customerId: p.customerId, name: primary.recipientName, phone: primary.phone });
    }
    return out;
  }
}

/** Records reward calls; optionally throws for chosen customers to exercise fail paths. */
export class FakeLoyaltyReward implements LoyaltyRewardPort {
  calls: { customerId: string; points: number; reason: string }[] = [];
  failFor = new Set<string>();
  async reward(customerId: string, points: number, reason: string): Promise<void> {
    if (this.failFor.has(customerId)) throw new Error('loyalty down');
    this.calls.push({ customerId, points, reason });
  }
}

export class InMemoryAddressRepository implements AddressRepository {
  rows: AddressRecord[] = [];

  async listByCustomer(customerId: string): Promise<AddressRecord[]> {
    return this.rows
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }
  async findByIdForCustomer(customerId: string, id: string): Promise<AddressRecord | null> {
    return this.rows.find((r) => r.id === id && r.customerId === customerId) ?? null;
  }
  async countByCustomer(customerId: string): Promise<number> {
    return this.rows.filter((r) => r.customerId === customerId).length;
  }
  async create(data: CreateAddressData): Promise<AddressRecord> {
    const now = nextDate();
    const rec: AddressRecord = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    this.rows.push(rec);
    return { ...rec };
  }
  async update(customerId: string, id: string, patch: UpdateAddressData): Promise<AddressRecord> {
    const rec = this.rows.find((r) => r.id === id && r.customerId === customerId)!;
    Object.assign(rec, patch, { updatedAt: nextDate() });
    return { ...rec };
  }
  async unsetPrimary(customerId: string): Promise<void> {
    this.rows.filter((r) => r.customerId === customerId).forEach((r) => (r.isPrimary = false));
  }
  async markPrimary(customerId: string, id: string): Promise<void> {
    const rec = this.rows.find((r) => r.id === id && r.customerId === customerId);
    if (rec) rec.isPrimary = true;
  }
  async delete(customerId: string, id: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.id === id && r.customerId === customerId));
  }
  async findMostRecent(customerId: string, exceptId?: string): Promise<AddressRecord | null> {
    const list = this.rows
      .filter((r) => r.customerId === customerId && r.id !== exceptId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list[0] ?? null;
  }
}

export class InMemoryNotificationRepository implements NotificationPreferenceRepository {
  private rows = new Map<string, NotificationPreferenceRecord>();
  async findByCustomerId(customerId: string): Promise<NotificationPreferenceRecord | null> {
    return this.rows.get(customerId) ?? null;
  }
  async upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord> {
    this.rows.set(record.customerId, { ...record });
    return { ...record };
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): CustomerConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    CUSTOMER_SERVICE_PORT: '3002',
    CUSTOMER_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    MAX_ADDRESSES_PER_CUSTOMER: '20',
    LOYALTY_SERVICE_URL: 'http://loyalty.test',
    BIRTHDAY_REWARD_POINTS: '250',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new CustomerConfigService(fake as unknown as ConfigService);
}
