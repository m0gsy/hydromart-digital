import { Inject, Injectable } from '@nestjs/common';
import { addLocalDays, localDayKey, startOfLocalDay } from '@hydromart/platform';

import { PromotionNotFoundError } from '../../domain/errors';
import {
  CreatePromotionData,
  PromotionRecord,
  PromotionRepository,
  UpdatePromotionData,
} from '../ports/promotion.repository';
import { OrderValuePort } from '../ports/order-value.port';
import { VoucherRepository } from '../ports/voucher.repository';
import { PromoConfigService } from '../../config/promo-config.service';
import { PROMO_TOKENS } from '../tokens';

/** How many customers the analytics card shows; the database applies the limit. */
const TOP_CUSTOMERS = 10;

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
    private readonly config: PromoConfigService,
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
    // H-16: the 7-day strip was bucketed on UTC days, so a redemption at 02:00 WIB
    // landed on the previous bar and "today" only began at 07:00 WIB.
    const tz = this.config.businessTimeZone;
    const todayStart = startOfLocalDay(now, tz).getTime();
    const firstDayUtc = addLocalDays(new Date(todayStart), -6, tz).getTime();
    const dailyUses = Array.from({ length: 7 }, (_, index) => ({
      day: localDayKey(addLocalDays(new Date(firstDayUtc), index, tz), tz),
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
    // Postgres does the counting (audit S-14). This used to read the voucher's entire
    // redemption history and make five passes over it here, so the better a campaign did,
    // the slower its own analytics page got.
    // The window ends at the START of tomorrow, local — a fixed +24h divisor is the
    // H-16 defect, and the day labels the database groups by have to be the same local
    // labels `dailyUses` was built with or every bucket reads zero.
    const stats = await this.vouchers.redemptionAnalytics(
      voucher.id,
      new Date(firstDayUtc),
      addLocalDays(new Date(todayStart), 1, tz),
      TOP_CUSTOMERS,
      tz,
    );
    if (stats.totalUses === 0) return empty();

    // The seven-day series is dense: a day with no redemptions still has to show a zero.
    const usesByDay = new Map(stats.dailyUses.map((row) => [row.day, row.uses]));
    for (const bucket of dailyUses) bucket.uses = usesByDay.get(bucket.day) ?? 0;

    const affectedOrderIds = stats.orderIds;
    const values = await this.orderValues.findOrderValues(affectedOrderIds);
    return {
      promotionId: promotion.id,
      title: promotion.title,
      voucherCode: promotion.voucherCode,
      totalUses: stats.totalUses,
      usesLast7Days: stats.usesInWindow,
      totalSavingsIdr: stats.totalSavingsIdr,
      affectedOrderIds,
      affectedOrderCount: affectedOrderIds.length,
      grossAffectedOrderValueIdr: values
        ? values.reduce((sum, value) => sum + value.totalIdr, 0)
        : null,
      dailyUses,
      topCustomers: stats.topCustomers,
      orderValueSource: values ? 'ok' : 'unavailable',
    };
  }

  private async getById(id: string): Promise<PromotionRecord> {
    const promotion = await this.repo.findById(id);
    if (!promotion) throw new PromotionNotFoundError();
    return promotion;
  }
}
