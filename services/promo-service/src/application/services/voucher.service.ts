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
import { assertFresh } from '@hydromart/platform';

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

/**
 * PRM-7: the public face of a voucher — what a customer needs to decide whether to type the
 * code, and nothing about how the campaign is doing.
 */
export interface PublicVoucherPreview {
  code: string;
  description: string | null;
  discountType: DiscountType;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  validUntil: Date | null;
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
   * blocks the grant). PRM-9: the contact is resolved by id under the internal key, not by
   * downloading the customer directory on the acting staff member's token.
   */
  async grant(
    voucherId: string,
    customerId: string,
  ): Promise<{ voucher: VoucherRecord; granted: boolean }> {
    const voucher = await this.repo.findById(voucherId);
    if (!voucher || !voucher.active) throw new VoucherNotFoundError();

    const granted = await this.repo.grantVoucher(voucherId, customerId);
    if (granted) {
      const contact = await this.customers.resolve(customerId);
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

  /**
   * PRM-6: the money rules a voucher must satisfy, whichever door it came through.
   *
   * These lived inline in `create`, and `update` — the door an existing campaign is edited
   * through — checked none of them. A voucher created at a legal 20% could be PATCHed to
   * 500% afterwards, which is the same defect CA-2-65 closed on the other door.
   */
  private assertMoneySane(discountType: DiscountType | undefined, value: number | undefined): void {
    if (discountType === undefined || value === undefined) return;
    // FREE_SHIPPING waives the delivery fee and needs no `value`; percent/fixed do.
    if (discountType !== DiscountType.FREE_SHIPPING && value <= 0) {
      throw new InvalidVoucherValueError();
    }
    if (discountType === DiscountType.PERCENTAGE && value > 100) {
      throw new InvalidVoucherValueError(`A percentage voucher cannot exceed 100% — got ${value}.`);
    }
  }

  /** Create a voucher (admin). Code is stored UPPERCASE and must be unique. */
  async create(input: CreateVoucherData): Promise<VoucherRecord> {
    const code = input.code.toUpperCase();
    /*
     * CA-2-65: a PERCENTAGE voucher could be created at 500%. The bound depends on ANOTHER
     * field, so it cannot live in the DTO — a `@Max(100)` on `value` would refuse a
     * Rp 50.000 fixed voucher. PRM-6 moved it into `assertMoneySane`, which the PATCH door
     * runs too.
     */
    this.assertMoneySane(input.discountType, input.value);
    if (await this.repo.findByCode(code)) throw new DuplicateVoucherCodeError(code);
    return this.repo.create({ ...input, code });
  }

  /**
   * Patch an existing voucher (admin).
   *
   * CA-2-53: refused when the caller's copy is older than the stored voucher — a discount
   * two people edited at once used to end up as whichever of them saved last.
   */
  async update(
    id: string,
    patch: UpdateVoucherData,
    seenUpdatedAt?: string,
  ): Promise<VoucherRecord> {
    const current = await this.getById(id);
    assertFresh(current.updatedAt, seenUpdatedAt);
    // PRM-6: the same money rules `create` enforces. A patch that changes only the value
    // is judged against the type the voucher already has.
    this.assertMoneySane(patch.discountType ?? current.discountType, patch.value ?? current.value);
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

  /**
   * PRM-7 — what an unauthenticated caller may learn about a code.
   *
   * `GET /vouchers/:code` was public and answered with the whole row: a draft voucher not
   * yet launched, a deactivated one, its budget cap, its usage counters, its depot. That is
   * an oracle — a script can sit on it and discover every campaign before it starts, then
   * watch `usedCount` move. It also confirmed which codes exist at all.
   *
   * A code somebody actually holds still previews. Anything else — inactive, not started,
   * expired, or addressed to specific customers — is answered exactly like a code that does
   * not exist, and only the fields a customer needs to decide come back.
   */
  async previewByCode(code: string): Promise<PublicVoucherPreview> {
    const voucher = await this.repo.findByCode(code.toUpperCase());
    const now = new Date();
    const visible =
      voucher !== null &&
      voucher.active &&
      voucher.audience !== 'GRANTED' &&
      (voucher.validFrom === null || now >= voucher.validFrom) &&
      (voucher.validUntil === null || now <= voucher.validUntil);
    if (!visible) throw new VoucherNotFoundError();
    return {
      code: voucher.code,
      description: voucher.description,
      discountType: voucher.discountType,
      value: voucher.value,
      minSpend: voucher.minSpend,
      maxDiscount: voucher.maxDiscount,
      validUntil: voucher.validUntil,
    };
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
    // PRM-4: a GRANTED voucher is only spendable by the people it was given to.
    const granted = await this.repo.hasGrant(voucher.id, customerId);
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
      granted,
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
    const granted = await this.repo.hasGrant(voucher.id, customerId);

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
          granted,
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
    // PRM-4: the repository returns only what this customer may spend — every PUBLIC code
    // plus the GRANTED ones addressed to them. The rule lives in the query rather than in
    // this mapper, because a filter in the reader is the kind that gets missed.
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
