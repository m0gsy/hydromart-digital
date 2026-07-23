import { Inject, Injectable } from '@nestjs/common';

import { PromotionNotFoundError } from '../../domain/errors';
import {
  CreatePromotionData,
  PromotionRecord,
  PromotionRepository,
  UpdatePromotionData,
} from '../ports/promotion.repository';
import { OrderValuePort } from '../ports/order-value.port';
import { VoucherRepository } from '../ports/voucher.repository';
import { PROMO_TOKENS } from '../tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PromotionAnalytics {
  promotionId: string;
  title: string;
  voucherCode: string | null;
  totalUses: number;
  usesLast7Days: number;
  totalSavingsIdr: number;
  affectedOrderIds: string[];
  affectedOrderCount: number;
  grossAffectedOrderValueIdr: number | null;
  dailyUses: { day: string; uses: number }[];
  topCustomers: { customerId: string; uses: number; savingsIdr: number }[];
  orderValueSource: 'ok' | 'unavailable' | 'not_applicable';
}

@Injectable()
export class PromotionService {
  constructor(
    @Inject(PROMO_TOKENS.PromotionRepository) private readonly repo: PromotionRepository,
    @Inject(PROMO_TOKENS.VoucherRepository) private readonly vouchers: VoucherRepository,
    @Inject(PROMO_TOKENS.OrderValues) private readonly orderValues: OrderValuePort,
  ) {}

  /** Live promotions for the customer Home page (active + inside date window). */
  listActive(now: Date = new Date()): Promise<PromotionRecord[]> {
    return this.repo.findActive(now);
  }

  /** All promotions incl. inactive/scheduled (admin). */
  listAll(): Promise<PromotionRecord[]> {
    return this.repo.findAll();
  }

  create(input: CreatePromotionData): Promise<PromotionRecord> {
    return this.repo.create(input);
  }

  async update(id: string, patch: UpdatePromotionData): Promise<PromotionRecord> {
    await this.getById(id);
    return this.repo.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.getById(id);
    await this.repo.delete(id);
  }

  async analytics(id: string, now: Date = new Date()): Promise<PromotionAnalytics> {
    const promotion = await this.getById(id);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const firstDayUtc = todayUtc - 6 * DAY_MS;
    const dailyUses = Array.from({ length: 7 }, (_, index) => ({
      day: new Date(firstDayUtc + index * DAY_MS).toISOString().slice(0, 10),
      uses: 0,
    }));
    const empty = (): PromotionAnalytics => ({
      promotionId: promotion.id,
      title: promotion.title,
      voucherCode: promotion.voucherCode,
      totalUses: 0,
      usesLast7Days: 0,
      totalSavingsIdr: 0,
      affectedOrderIds: [],
      affectedOrderCount: 0,
      grossAffectedOrderValueIdr: 0,
      dailyUses,
      topCustomers: [],
      orderValueSource: 'not_applicable',
    });

    if (!promotion.voucherCode) return empty();
    const voucher = await this.vouchers.findByCode(promotion.voucherCode.trim().toUpperCase());
    if (!voucher) return empty();
    const redemptions = await this.vouchers.findRedemptionsFor(voucher.id);
    if (redemptions.length === 0) return empty();

    const customers = new Map<string, { uses: number; savingsIdr: number }>();
    let totalSavingsIdr = 0;
    let usesLast7Days = 0;
    for (const redemption of redemptions) {
      totalSavingsIdr += redemption.discountApplied;
      const customer = customers.get(redemption.customerId) ?? { uses: 0, savingsIdr: 0 };
      customer.uses += 1;
      customer.savingsIdr += redemption.discountApplied;
      customers.set(redemption.customerId, customer);

      const createdAt = redemption.createdAt.getTime();
      if (createdAt >= firstDayUtc && createdAt < todayUtc + DAY_MS) {
        usesLast7Days += 1;
        dailyUses[Math.floor((createdAt - firstDayUtc) / DAY_MS)].uses += 1;
      }
    }

    const affectedOrderIds = [...new Set(redemptions.map((redemption) => redemption.orderId))];
    const values = await this.orderValues.findOrderValues(affectedOrderIds);
    return {
      promotionId: promotion.id,
      title: promotion.title,
      voucherCode: promotion.voucherCode,
      totalUses: redemptions.length,
      usesLast7Days,
      totalSavingsIdr,
      affectedOrderIds,
      affectedOrderCount: affectedOrderIds.length,
      grossAffectedOrderValueIdr: values
        ? values.reduce((sum, value) => sum + value.totalIdr, 0)
        : null,
      dailyUses,
      topCustomers: [...customers.entries()]
        .map(([customerId, aggregate]) => ({ customerId, ...aggregate }))
        .sort(
          (a, b) =>
            b.uses - a.uses ||
            b.savingsIdr - a.savingsIdr ||
            a.customerId.localeCompare(b.customerId),
        )
        .slice(0, 10),
      orderValueSource: values ? 'ok' : 'unavailable',
    };
  }

  private async getById(id: string): Promise<PromotionRecord> {
    const promotion = await this.repo.findById(id);
    if (!promotion) throw new PromotionNotFoundError();
    return promotion;
  }
}
