import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DuplicateVoucherCodeError,
  InvalidVoucherValueError,
  VoucherNotFoundError,
} from '../../domain/errors';
import {
  DiscountType,
  VoucherStatus,
  classifyVoucherStatus,
  computeDiscount,
  validateVoucher,
} from '../../domain/voucher';
import { Page, buildPage } from '../pagination';
import { CustomerLookupPort } from '../ports/customer-lookup.port';
import { NotificationPort } from '../ports/notification.port';
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

export interface WalletVoucher {
  voucher: VoucherRecord;
  status: VoucherStatus;
}

@Injectable()
export class VoucherService {
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    @Inject(PROMO_TOKENS.VoucherRepository) private readonly repo: VoucherRepository,
    @Inject(PROMO_TOKENS.CustomerLookup) private readonly customers: CustomerLookupPort,
    @Inject(PROMO_TOKENS.Notification) private readonly notifications: NotificationPort,
  ) {}

  /**
   * Grant an existing voucher to a specific customer's wallet (spec 5h "voucher baru").
   * Idempotent per (voucher, customer) — a repeat grant is a no-op and re-sends nothing.
   * On the first grant, fires VOUCHER_GRANTED via crm (fail-open: notification never
   * blocks the grant). Requires the acting staff token to resolve the customer's contact.
   */
  async grant(
    voucherId: string,
    customerId: string,
    authorization: string,
  ): Promise<{ voucher: VoucherRecord; granted: boolean }> {
    const voucher = await this.repo.findById(voucherId);
    if (!voucher || !voucher.active) throw new VoucherNotFoundError();

    const granted = await this.repo.grantVoucher(voucherId, customerId);
    if (granted) {
      const contact = await this.customers.resolve(customerId, authorization);
      if (contact) {
        await this.notifications.notify('VOUCHER_GRANTED', contact.phone, customerId, {
          name: contact.name,
          code: voucher.code,
          description: voucher.description ?? 'voucher hemat',
        });
      }
    }
    return { voucher, granted };
  }

  /** Create a voucher (admin). Code is stored UPPERCASE and must be unique. */
  async create(input: CreateVoucherData): Promise<VoucherRecord> {
    const code = input.code.toUpperCase();
    // FREE_SHIPPING waives the delivery fee and needs no `value`; percent/fixed do.
    if (input.discountType !== DiscountType.FREE_SHIPPING && input.value <= 0) {
      throw new InvalidVoucherValueError();
    }
    /*
     * CA-2-65: a PERCENTAGE voucher could be created at 500%.
     *
     * The column comment says "PERCENTAGE: a percent 1..100", both DTOs repeat it in their
     * `@ApiProperty` description, and not one of them enforced it — `@Min(0)` was the whole
     * check. A voucher at 500 does not fail anywhere either: the discount is computed as a
     * fraction of the subtotal, so it simply pays the customer more than the order is worth,
     * capped only by `maxDiscount` when somebody remembered to set one. And nothing on the
     * HQ form sets one for a percentage voucher by default.
     *
     * Checked here rather than in the DTOs because the bound depends on ANOTHER field, and
     * because both doors — the HQ form and an approved depot request — come through this
     * method. A `@Max(100)` on `value` would have refused a Rp 50.000 fixed voucher.
     */
    if (input.discountType === DiscountType.PERCENTAGE && input.value > 100) {
      throw new InvalidVoucherValueError(
        `A percentage voucher cannot exceed 100% — got ${input.value}.`,
      );
    }
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
   * HQ voucher governance (design 14b): real rupiah discount burned per voucher plus
   * the network total. `byVoucher` is keyed by voucher id; vouchers with no redemption
   * are absent (the UI defaults them to 0). No budget cap exists as data.
   */
  async burnSummary(): Promise<{ totalUsed: number; byVoucher: Record<string, number> }> {
    const rows = await this.repo.sumRedemptionsByVoucher();
    const byVoucher: Record<string, number> = {};
    let totalUsed = 0;
    for (const r of rows) {
      byVoucher[r.voucherId] = r.burned;
      totalUsed += r.burned;
    }
    return { totalUsed, byVoucher };
  }

  /**
   * Preview the discount a voucher would grant for a customer's order. Runs the
   * full validation (throws on any failing rule) but has NO side effect.
   */
  /**
   * CA-2-65: `depotId` is where the depot scope is actually enforced.
   *
   * Not `redeem` — that one fails OPEN by design, so an order already priced with the
   * discount would keep it. `quote` fails CLOSED, so this is the door.
   */
  async quote(
    code: string,
    customerId: string,
    subtotal: number,
    shippingFee = 0,
    depotId?: string | null,
  ): Promise<QuoteResult> {
    const voucher = await this.getByCode(code);
    const customerRedemptionCount = await this.repo.countRedemptions(voucher.id, customerId);
    const burned = voucher.budgetCap !== null ? await this.repo.sumRedemptionsFor(voucher.id) : 0;
    // computeDiscount is pure and never throws, so it can run before validation — the
    // budget rule needs this order's own discount to enforce a hard cap.
    const discount = computeDiscount(voucher, subtotal, shippingFee);
    validateVoucher(
      voucher,
      subtotal,
      new Date(),
      voucher.usedCount,
      customerRedemptionCount,
      burned + discount,
      depotId,
    );
    return { code: voucher.code, discountType: voucher.discountType, discount, valid: true };
  }

  /**
   * Redeem a voucher for an order. Idempotent per orderId: a repeat call returns
   * the recorded redemption unchanged. Otherwise re-runs the same validation,
   * computes the discount, and atomically records the redemption + increments the
   * global usedCount.
   */
  /**
   * C4: give the voucher back when the sale it paid for is undone.
   *
   * A voided counter sale returned the goods and the money, but the buyer's voucher stayed
   * burned — the redemption row survived and `usedCount` stayed incremented, so a
   * single-use voucher was spent on a sale that never happened. `PromoPort` had no reversal
   * method at all, so nothing could even ask for this.
   *
   * IDEMPOTENT: releasing an order twice is a no-op the second time, because the row is
   * already gone. That matters — a void retried after a timeout must not decrement the
   * counter twice and hand out a use that was never taken.
   */
  async release(orderId: string): Promise<{ released: boolean; discountReturned: number }> {
    const released = await this.repo.releaseAtomic(orderId);
    if (!released) return { released: false, discountReturned: 0 };
    this.logger.log(`Voucher ${released.voucherCode} released for voided order ${orderId}`);
    return { released: true, discountReturned: released.discountApplied };
  }

  async redeem(
    code: string,
    customerId: string,
    orderId: string,
    subtotal: number,
    shippingFee = 0,
    depotId?: string | null,
  ): Promise<RedeemResult> {
    const existing = await this.repo.findRedemptionByOrder(orderId);
    if (existing) {
      return { orderId: existing.orderId, discountApplied: existing.discountApplied };
    }

    const voucher = await this.getByCode(code);

    // H-1: the caps are checked INSIDE the lock, not before it. Reading usedCount, the
    // per-customer count and the burned budget on a separate connection and then writing
    // meant N concurrent redemptions of one code all saw the same pre-write numbers, all
    // passed, and all committed — usageLimit, perCustomerLimit and budgetCap were each
    // bypassable by sending the requests together rather than in sequence.
    const redemption = await this.repo.redeemAtomic(
      { voucherId: voucher.id, voucherCode: voucher.code, customerId, orderId },
      ({ usedCount, customerRedemptions, burned }) => {
        const discount = computeDiscount(voucher, subtotal, shippingFee);
        // Throws on a cap violation, which rolls the transaction back — so a voucher that
        // ran out between quote and redeem burns nothing.
        validateVoucher(
          voucher,
          subtotal,
          new Date(),
          usedCount,
          customerRedemptions,
          burned + discount,
          depotId,
        );
        return discount;
      },
    );
    return { orderId: redemption.orderId, discountApplied: redemption.discountApplied };
  }

  /**
   * The customer's voucher wallet (spec 4a): every active voucher with a
   * per-customer status (available / used / expired / upcoming / sold-out).
   */
  async myVouchers(customerId: string): Promise<WalletVoucher[]> {
    const now = new Date();
    const rows = await this.repo.listForCustomer(customerId);
    return rows.map(({ voucher, customerRedemptions }) => ({
      voucher,
      status: classifyVoucherStatus(voucher, now, customerRedemptions),
    }));
  }

  private async getById(id: string): Promise<VoucherRecord> {
    const voucher = await this.repo.findById(id);
    if (!voucher) throw new VoucherNotFoundError();
    return voucher;
  }
}
