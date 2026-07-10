import { Inject, Injectable } from '@nestjs/common';

import { DuplicateVoucherCodeError, VoucherNotFoundError } from '../../domain/errors';
import { DiscountType, computeDiscount, validateVoucher } from '../../domain/voucher';
import { Page, buildPage } from '../pagination';
import {
  CreateVoucherData,
  UpdateVoucherData,
  VoucherRecord,
  VoucherRepository,
} from '../ports/voucher.repository';
import { PROMO_TOKENS } from '../tokens';

export interface QuoteResult {
  code: string;
  discountType: DiscountType;
  discount: number;
  valid: true;
}

export interface RedeemResult {
  orderId: string;
  discountApplied: number;
}

@Injectable()
export class VoucherService {
  private static readonly MAX_LIMIT = 100;

  constructor(
    @Inject(PROMO_TOKENS.VoucherRepository) private readonly repo: VoucherRepository,
  ) {}

  /** Create a voucher (admin). Code is stored UPPERCASE and must be unique. */
  async create(input: CreateVoucherData): Promise<VoucherRecord> {
    const code = input.code.toUpperCase();
    if (await this.repo.findByCode(code)) throw new DuplicateVoucherCodeError(code);
    return this.repo.create({ ...input, code });
  }

  /** Patch an existing voucher (admin). */
  async update(id: string, patch: UpdateVoucherData): Promise<VoucherRecord> {
    await this.getById(id);
    return this.repo.update(id, patch);
  }

  /** Soft-disable a voucher (admin). */
  async deactivate(id: string): Promise<VoucherRecord> {
    await this.getById(id);
    return this.repo.update(id, { active: false });
  }

  /** Look up a voucher by its (case-insensitive) code. */
  async getByCode(code: string): Promise<VoucherRecord> {
    const voucher = await this.repo.findByCode(code.toUpperCase());
    if (!voucher) throw new VoucherNotFoundError();
    return voucher;
  }

  async browse(page = 1, limit = 20, activeOnly = false): Promise<Page<VoucherRecord>> {
    const p = Math.max(1, page);
    const l = Math.min(VoucherService.MAX_LIMIT, Math.max(1, limit));
    const { items, total } = await this.repo.search(p, l, activeOnly);
    return buildPage(items, total, p, l);
  }

  /**
   * Preview the discount a voucher would grant for a customer's order. Runs the
   * full validation (throws on any failing rule) but has NO side effect.
   */
  async quote(code: string, customerId: string, subtotal: number): Promise<QuoteResult> {
    const voucher = await this.getByCode(code);
    const customerRedemptionCount = await this.repo.countRedemptions(voucher.id, customerId);
    validateVoucher(voucher, subtotal, new Date(), voucher.usedCount, customerRedemptionCount);
    const discount = computeDiscount(voucher, subtotal);
    return { code: voucher.code, discountType: voucher.discountType, discount, valid: true };
  }

  /**
   * Redeem a voucher for an order. Idempotent per orderId: a repeat call returns
   * the recorded redemption unchanged. Otherwise re-runs the same validation,
   * computes the discount, and atomically records the redemption + increments the
   * global usedCount.
   */
  async redeem(
    code: string,
    customerId: string,
    orderId: string,
    subtotal: number,
  ): Promise<RedeemResult> {
    const existing = await this.repo.findRedemptionByOrder(orderId);
    if (existing) {
      return { orderId: existing.orderId, discountApplied: existing.discountApplied };
    }

    const voucher = await this.getByCode(code);
    const customerRedemptionCount = await this.repo.countRedemptions(voucher.id, customerId);
    validateVoucher(voucher, subtotal, new Date(), voucher.usedCount, customerRedemptionCount);
    const discount = computeDiscount(voucher, subtotal);

    const redemption = await this.repo.recordRedemption({
      voucherId: voucher.id,
      voucherCode: voucher.code,
      customerId,
      orderId,
      discountApplied: discount,
    });
    return { orderId: redemption.orderId, discountApplied: redemption.discountApplied };
  }

  private async getById(id: string): Promise<VoucherRecord> {
    const voucher = await this.repo.findById(id);
    if (!voucher) throw new VoucherNotFoundError();
    return voucher;
  }
}
