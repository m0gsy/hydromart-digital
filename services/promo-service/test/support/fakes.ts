import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { VoucherNotFoundError } from '../../src/domain/errors';

import { PromoConfigService } from '../../src/config/promo-config.service';
import {
  CreatePromotionData,
  PromotionRecord,
  PromotionRepository,
  UpdatePromotionData,
} from '../../src/application/ports/promotion.repository';
import {
  CreateVoucherData,
  RedemptionMutation,
  UpdateVoucherData,
  VoucherRecord,
  VoucherRedemptionRecord,
  VoucherRepository,
  RedemptionAnalytics,
} from '../../src/application/ports/voucher.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryPromotionRepository implements PromotionRepository {
  rows: PromotionRecord[] = [];

  async findById(id: string): Promise<PromotionRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async create(data: CreatePromotionData): Promise<PromotionRecord> {
    const now = nextDate();
    const row = { id: randomUUID(), active: true, createdAt: now, updatedAt: now, ...data };
    this.rows.push(row);
    return row;
  }

  async update(id: string, data: UpdatePromotionData): Promise<PromotionRecord> {
    const row = this.rows.find((candidate) => candidate.id === id)!;
    Object.assign(row, data);
    return row;
  }

  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  async findAll(): Promise<PromotionRecord[]> {
    return [...this.rows];
  }

  async findActive(now: Date): Promise<PromotionRecord[]> {
    return this.rows.filter(
      (row) =>
        row.active &&
        (!row.startsAt || row.startsAt <= now) &&
        (!row.endsAt || row.endsAt >= now),
    );
  }
}

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
      budgetCap: data.budgetCap ?? null,
      usedCount: 0,
      active: data.active ?? true,
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

  async sumRedemptionsByVoucher(): Promise<{ voucherId: string; burned: number }[]> {
    const map = new Map<string, number>();
    for (const r of this.redemptions) {
      map.set(r.voucherId, (map.get(r.voucherId) ?? 0) + r.discountApplied);
    }
    return [...map.entries()].map(([voucherId, burned]) => ({ voucherId, burned }));
  }

  async sumRedemptionsFor(voucherId: string): Promise<number> {
    return this.redemptions
      .filter((r) => r.voucherId === voucherId)
      .reduce((sum, r) => sum + r.discountApplied, 0);
  }

  async findRedemptionByOrder(orderId: string): Promise<VoucherRedemptionRecord | null> {
    const r = this.redemptions.find((x) => x.orderId === orderId);
    return r ? { ...r } : null;
  }

  // Audit S-14: the aggregate the database now computes. Modelled on the same rows the
  // fake already holds, so a test that seeds redemptions still gets the real numbers.
  async redemptionAnalytics(
    voucherId: string,
    from: Date,
    to: Date,
    topCustomers: number,
  ): Promise<RedemptionAnalytics> {
    const rows = this.redemptions.filter((r) => r.voucherId === voucherId);
    const inWindow = rows.filter((r) => r.createdAt >= from && r.createdAt < to);
    const byDay = new Map<string, number>();
    for (const row of inWindow) {
      const day = row.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const byCustomer = new Map<string, { uses: number; savingsIdr: number }>();
    for (const row of rows) {
      const current = byCustomer.get(row.customerId) ?? { uses: 0, savingsIdr: 0 };
      current.uses += 1;
      current.savingsIdr += row.discountApplied;
      byCustomer.set(row.customerId, current);
    }
    return {
      totalUses: rows.length,
      totalSavingsIdr: rows.reduce((sum, r) => sum + r.discountApplied, 0),
      usesInWindow: inWindow.length,
      dailyUses: [...byDay.entries()]
        .map(([day, uses]) => ({ day, uses }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      topCustomers: [...byCustomer.entries()]
        .map(([customerId, aggregate]) => ({ customerId, ...aggregate }))
        .sort(
          (a, b) =>
            b.uses - a.uses ||
            b.savingsIdr - a.savingsIdr ||
            a.customerId.localeCompare(b.customerId),
        )
        .slice(0, topCustomers),
      orderIds: [
        ...new Set(
          [...rows]
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((r) => r.orderId),
        ),
      ],
    };
  }

  async findRedemptionsFor(voucherId: string): Promise<VoucherRedemptionRecord[]> {
    return this.redemptions
      .filter((redemption) => redemption.voucherId === voucherId)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
      )
      .map((redemption) => ({ ...redemption }));
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

  /**
   * Single-threaded stand-in for the locked redeem (H-1). It cannot reproduce the race —
   * only real Postgres can — but it does enforce the ordering the real one guarantees:
   * the counts handed to `decide` are read now, and nothing is written if `decide` throws.
   */
  async redeemAtomic(
    input: { voucherId: string; voucherCode: string; customerId: string; orderId: string },
    decide: (counts: { usedCount: number; customerRedemptions: number; burned: number }) => number,
  ): Promise<VoucherRedemptionRecord> {
    const voucher = this.vouchers.find((x) => x.id === input.voucherId);
    if (!voucher) throw new VoucherNotFoundError();
    const forVoucher = this.redemptions.filter((r) => r.voucherId === input.voucherId);
    const discountApplied = decide({
      usedCount: voucher.usedCount,
      customerRedemptions: forVoucher.filter((r) => r.customerId === input.customerId).length,
      burned: forVoucher.reduce((sum, r) => sum + r.discountApplied, 0),
    });
    return this.recordRedemption({ ...input, discountApplied });
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
    ORDER_SERVICE_URL: 'http://localhost:3004',
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
