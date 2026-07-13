import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PromoConfigService } from '../../src/config/promo-config.service';
import {
  CreateVoucherData,
  RedemptionMutation,
  UpdateVoucherData,
  VoucherRecord,
  VoucherRedemptionRecord,
  VoucherRepository,
} from '../../src/application/ports/voucher.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryVoucherRepository implements VoucherRepository {
  vouchers: VoucherRecord[] = [];
  redemptions: VoucherRedemptionRecord[] = [];

  async findById(id: string): Promise<VoucherRecord | null> {
    const v = this.vouchers.find((x) => x.id === id);
    return v ? { ...v } : null;
  }

  async findByCode(code: string): Promise<VoucherRecord | null> {
    const v = this.vouchers.find((x) => x.code === code);
    return v ? { ...v } : null;
  }

  async create(data: CreateVoucherData): Promise<VoucherRecord> {
    const now = nextDate();
    const v: VoucherRecord = {
      id: randomUUID(),
      code: data.code,
      description: data.description,
      discountType: data.discountType,
      value: data.value,
      minSpend: data.minSpend,
      maxDiscount: data.maxDiscount,
      validFrom: data.validFrom,
      validUntil: data.validUntil,
      usageLimit: data.usageLimit,
      perCustomerLimit: data.perCustomerLimit,
      usedCount: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.vouchers.push(v);
    return { ...v };
  }

  async update(id: string, data: UpdateVoucherData): Promise<VoucherRecord> {
    const v = this.vouchers.find((x) => x.id === id)!;
    // Only overwrite keys that were actually provided (undefined = leave as-is).
    const target = v as unknown as Record<string, unknown>;
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) target[key] = val;
    }
    v.updatedAt = nextDate();
    return { ...v };
  }

  async search(
    page: number,
    limit: number,
    activeOnly: boolean,
  ): Promise<{ items: VoucherRecord[]; total: number }> {
    const all = this.vouchers
      .filter((v) => (activeOnly ? v.active : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit).map((v) => ({ ...v })), total: all.length };
  }

  async countRedemptions(voucherId: string, customerId?: string): Promise<number> {
    return this.redemptions.filter(
      (r) => r.voucherId === voucherId && (customerId ? r.customerId === customerId : true),
    ).length;
  }

  async listForCustomer(
    customerId: string,
  ): Promise<{ voucher: VoucherRecord; customerRedemptions: number }[]> {
    return this.vouchers
      .filter((v) => v.active)
      .map((v) => ({
        voucher: { ...v },
        customerRedemptions: this.redemptions.filter(
          (r) => r.voucherId === v.id && r.customerId === customerId,
        ).length,
      }));
  }

  async findRedemptionByOrder(orderId: string): Promise<VoucherRedemptionRecord | null> {
    const r = this.redemptions.find((x) => x.orderId === orderId);
    return r ? { ...r } : null;
  }

  async recordRedemption(m: RedemptionMutation): Promise<VoucherRedemptionRecord> {
    const redemption: VoucherRedemptionRecord = {
      id: randomUUID(),
      voucherId: m.voucherId,
      voucherCode: m.voucherCode,
      customerId: m.customerId,
      orderId: m.orderId,
      discountApplied: m.discountApplied,
      createdAt: nextDate(),
    };
    this.redemptions.push(redemption);
    const voucher = this.vouchers.find((x) => x.id === m.voucherId)!;
    voucher.usedCount += 1;
    return { ...redemption };
  }

  grants: { voucherId: string; customerId: string }[] = [];
  async grantVoucher(voucherId: string, customerId: string): Promise<boolean> {
    if (this.grants.some((g) => g.voucherId === voucherId && g.customerId === customerId)) {
      return false;
    }
    this.grants.push({ voucherId, customerId });
    return true;
  }
}

export class FakeCustomerLookup {
  contact: { name: string; phone: string } | null = { name: 'Budi', phone: '+6281234567890' };
  calls: { customerId: string; authorization: string }[] = [];
  async resolve(customerId: string, authorization: string) {
    this.calls.push({ customerId, authorization });
    return this.contact;
  }
}

export class FakeNotification {
  calls: { event: string; phone: string; customerId: string; vars: Record<string, string> }[] = [];
  async notify(event: string, phone: string, customerId: string, vars: Record<string, string>) {
    this.calls.push({ event, phone, customerId, vars });
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): PromoConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    PROMO_SERVICE_PORT: '3010',
    PROMO_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new PromoConfigService(fake as unknown as ConfigService);
}
