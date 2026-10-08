import { Inject, Injectable } from '@nestjs/common';
import { assertFresh } from '@hydromart/platform';

import {
  CartLine,
  EvaluationContext,
  GiftResult,
  LineResult,
  OrderDiscountResult,
  PromoRuleChannel,
  ShippingResult,
  evaluateGifts,
  evaluateLine,
  evaluateOrderDiscount,
  evaluateShipping,
} from '../../domain/promo-rule';
import { PromoRuleNotFoundError, PromoRuleValidationError } from '../../domain/errors';
import {
  CreatePromoRuleData,
  PromoRuleRecord,
  PromoRuleRepository,
  UpdatePromoRuleData,
} from '../ports/promo-rule.repository';
import { PromoConfigService } from '../../config/promo-config.service';
import { PROMO_TOKENS } from '../tokens';

export { PromoRuleValidationError } from '../../domain/errors';

export interface QuoteInput {
  depotId: string | null;
  channel: PromoRuleChannel;
  occurredAt: Date;
  lines: CartLine[];
  /** True when the caller knows the customer has no earlier active/completed order. */
  firstOrder?: boolean;
}

export interface QuoteOutput {
  lines: LineResult[];
  shipping: ShippingResult;
  /** Order-level discount (ORDER_DISCOUNT); amount 0 when none applied. */
  orderDiscount: OrderDiscountResult;
  /** Free products from BUNDLE_GIFT rules. The caller decides whether it can deliver them. */
  gifts: GiftResult[];
}

export interface ApplyOriginalLine {
  productId: string;
  unitPrice: number;
  quantity: number;
}

export interface ApplyInput {
  orderId: string;
  /** The exact cart lines the caller priced — same order/length as `quotedLines`. */
  originalLines: ApplyOriginalLine[];
  /** The exact `LineResult[]` the caller already computed via a prior `quote()` call. */
  quotedLines: LineResult[];
  /** The exact `ShippingResult` the caller already computed via that same `quote()` call. */
  quotedShipping: ShippingResult;
  /**
   * The per-unit delivery fee that was in effect BEFORE any promo override — needed to
   * compute the real shipping discount, since this service never learns it otherwise.
   * Omit/null if the order has no shipping-fee concept, or if `quotedShipping.appliedRuleId`
   * is null (no shipping rule won) — in either case no shipping audit row is written.
   */
  originalShippingFee?: number | null;
  /**
   * The total galon/unit count the shipping fee applies across — the same quantity the
   * caller used to compute the delivery fee itself (`deliveryFee × quantity`). Shipping fees
   * here are PER-GALON, so the real discount is per-unit too. 0 is a legitimate value (a
   * shipping-only order with no galon lines). No safe default: if `originalShippingFee` is
   * set but this is missing, the shipping row is skipped entirely rather than guessed.
   */
  shippingUnits?: number;
  /** The ORDER_DISCOUNT that was applied, with the rupiah actually taken off. */
  orderDiscount?: { appliedRuleId: string | null; amount: number };
  /** Gifts the caller actually put on the order (a gift it could not deliver is not listed). */
  gifts?: { promoRuleId: string; productId: string; value: number }[];
}

@Injectable()
export class PromoRuleService {
  constructor(
    @Inject(PROMO_TOKENS.PromoRuleRepository) private readonly repo: PromoRuleRepository,
    private readonly config: PromoConfigService,
  ) {}

  findAll(depotIds?: readonly string[]): Promise<PromoRuleRecord[]> {
    return this.repo.findAll(depotIds);
  }

  async findById(id: string): Promise<PromoRuleRecord> {
    const row = await this.repo.findById(id);
    if (!row) throw new PromoRuleNotFoundError();
    return row;
  }

  async create(input: CreatePromoRuleData): Promise<PromoRuleRecord> {
    this.validate(input);
    return this.repo.create(input);
  }

  /**
   * CA-2-53: refused when the caller's copy is older than the stored rule — same property
   * as Promotion, a promo rule decides what a customer is charged.
   */
  async update(
    id: string,
    patch: UpdatePromoRuleData,
    seenUpdatedAt?: string,
  ): Promise<PromoRuleRecord> {
    const current = await this.findById(id);
    assertFresh(current.updatedAt, seenUpdatedAt);
    // The controller always sends every DTO field explicitly, `undefined` for whatever the
    // caller omitted from the PATCH body. Spreading that over `current` unfiltered would
    // overwrite real stored values with `undefined` before validation ever sees them — e.g.
    // a PATCH that only sets `validUntil` would wipe out the stored `validFrom` first and
    // wrongly pass the validFrom>validUntil check. Strip undefined keys before merging so
    // validation runs against what would actually end up stored.
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    this.validate({ ...current, ...definedPatch });
    return this.repo.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    // Fix 5: the P2003→PromoRuleInUseError translation now lives in the repository (same
    // discipline as recordApplications' P2002 handling) — this is a plain pass-through.
    await this.repo.delete(id);
  }

  async quote(input: QuoteInput): Promise<QuoteOutput> {
    // `undefined` here means "no filter at all" per the repository's own doc comment —
    // correct for admin LISTING (findAll), but at checkout it would fetch every depot's
    // candidates when `input.depotId` is null, instead of just network-wide (depotId-null)
    // rules. An empty array narrows findActiveCandidates's `OR` to the null-only case.
    const candidates = await this.repo.findActiveCandidates(
      input.depotId ? [input.depotId] : [],
      input.occurredAt,
    );
    const ctx: EvaluationContext = {
      channel: input.channel,
      occurredAt: input.occurredAt,
      timeZone: this.config.businessTimeZone,
      depotId: input.depotId,
      firstOrder: input.firstOrder === true,
    };
    const lines = input.lines.map((line) => evaluateLine(candidates, line, ctx));
    // The subtotal an ORDER_DISCOUNT is judged on: every line after its item promos (a
    // wholesale line comes back untouched, at its own price).
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    return {
      lines,
      shipping: evaluateShipping(candidates, ctx),
      orderDiscount: evaluateOrderDiscount(candidates, ctx, subtotal),
      gifts: evaluateGifts(candidates, input.lines, ctx),
    };
  }

  /**
   * Persists `PromoApplication` audit rows for an order, FROM a `quote()` result the caller
   * already computed and acted on — this method does no matching of its own. Idempotent per
   * `orderId`: a cheap pre-check short-circuits a repeat call, and a unique DB constraint
   * (caught in the repository) is the real safety net under concurrent/retried calls, same
   * two-layer discipline as `VoucherRepository.redeemAtomic`.
   */
  async apply(input: ApplyInput): Promise<void> {
    if (await this.repo.hasApplicationFor(input.orderId)) return;

    const rows: { promoRuleId: string; productId: string | null; discountValue: number }[] = [];

    for (let i = 0; i < input.quotedLines.length; i++) {
      const line = input.quotedLines[i];
      const original = input.originalLines[i];

      // evaluateLine always pushes the SPECIAL_PRICE winner (if any) BEFORE the BUY_X_GET_Y
      // winner (if any) — see domain/promo-rule.ts. So: a price reduction, if present, is
      // ALWAYS appliedRuleIds[0]; a BOGO win, if present, is ALWAYS the LAST element — this
      // holds whether one or both kinds won, so don't destructure positionally as [a, b].
      const priceWon = original.unitPrice > line.unitPriceAfter;
      const bogoWon = line.freeQty > 0;

      // Fix 7: the caller's appliedRuleIds length must agree with what priceWon/bogoWon say
      // actually happened — otherwise bad caller data would silently write fewer audit rows
      // than it claims (or claim rows that never won anything), losing audit information
      // with no signal. Reject loudly instead of reconciling best-effort.
      const expectedRows = (priceWon ? 1 : 0) + (bogoWon ? 1 : 0);
      if (expectedRows !== line.appliedRuleIds.length) {
        throw new PromoRuleValidationError(
          `apply(): productId ${line.productId} mengirim ${line.appliedRuleIds.length} ` +
            `appliedRuleIds, tapi hasil kemenangan (priceWon=${priceWon}, bogoWon=${bogoWon}) ` +
            `mengharapkan ${expectedRows} — data caller tidak konsisten.`,
        );
      }
      if (line.appliedRuleIds.length === 0) continue;

      if (priceWon) {
        rows.push({
          promoRuleId: line.appliedRuleIds[0],
          productId: line.productId,
          discountValue: (original.unitPrice - line.unitPriceAfter) * original.quantity,
        });
      }
      if (bogoWon) {
        rows.push({
          promoRuleId: line.appliedRuleIds[line.appliedRuleIds.length - 1],
          productId: line.productId,
          // Giveaway units valued at the line's already-discounted price — the marginal cost
          // to the business of handing over one more unit today, not the pre-discount list
          // price. (Documented convention; the alternative — valuing at list price — is also
          // defensible and was explicitly left to this implementation to pick.)
          discountValue: line.freeQty * line.unitPriceAfter,
        });
      }
    }

    // D-1: shippingUnits has no safe default — the DTO requires it whenever
    // originalShippingFee is sent, but a caller that bypasses DTO validation (direct service
    // call, future integration) could still send one without the other. Rather than guess
    // (and silently under/over-record the discount), skip the shipping row entirely.
    if (
      input.quotedShipping.appliedRuleId &&
      input.originalShippingFee != null &&
      input.shippingUnits != null
    ) {
      const override = input.quotedShipping.shippingFeeOverride ?? 0;
      // I-2 (shipping sibling of the SPECIAL_PRICE price-raise guard): if the "override" is
      // actually higher than the original fee, this is not a discount — never write a
      // negative discountValue, just skip the row. Fix 4: strict `>`, matching the
      // SPECIAL_PRICE path — an UNCHANGED fee is not a discount either, so no audit row
      // (and no discountValue: 0 row) when the fee never actually moved.
      if (input.originalShippingFee > override) {
        rows.push({
          promoRuleId: input.quotedShipping.appliedRuleId,
          productId: null,
          // Per-galon fee × the unit count it applies across (C-1) — shippingFeeOverride and
          // originalShippingFee are both PER-GALON values, so without this multiplier an
          // order with more than one galon under-records its real discount. shippingUnits
          // may legitimately be 0 (shipping-only order, no galon lines), in which case this
          // correctly records a 0 discount rather than skipping the row.
          discountValue: (input.originalShippingFee - override) * input.shippingUnits,
        });
      }
    }

    // ORDER_DISCOUNT: one row for the order, no product (the same shape as the shipping row; the
    // unique index on (orderId, promoRuleId) WHERE productId IS NULL guards a replay).
    if (input.orderDiscount?.appliedRuleId && input.orderDiscount.amount > 0) {
      rows.push({
        promoRuleId: input.orderDiscount.appliedRuleId,
        productId: null,
        discountValue: input.orderDiscount.amount,
      });
    }
    // BUNDLE_GIFT: one row per gift product, valued at what the caller says it was worth.
    for (const gift of input.gifts ?? []) {
      if (gift.value > 0) {
        rows.push({ promoRuleId: gift.promoRuleId, productId: gift.productId, discountValue: gift.value });
      }
    }

    if (rows.length === 0) return;

    // I-1a: merge rows sharing the same (promoRuleId, productId) key by summing their
    // discountValue. Without this, a caller bug that produces two cart lines winning the
    // same rule for the same product would hand createMany two rows with the same key —
    // createMany throws P2002 for a reason that has nothing to do with concurrency, and the
    // repository would (correctly, per I-1b) treat that as "not this order's row" and
    // rethrow, failing the whole audit for a cause unrelated to any real race.
    const merged = new Map<string, { promoRuleId: string; productId: string | null; discountValue: number }>();
    for (const row of rows) {
      const key = `${row.promoRuleId}:${row.productId ?? ''}`;
      const existing = merged.get(key);
      if (existing) existing.discountValue += row.discountValue;
      else merged.set(key, { ...row });
    }

    await this.repo.recordApplications(input.orderId, [...merged.values()]);
  }

  private validate(data: Partial<CreatePromoRuleData>): void {
    if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
      throw new PromoRuleValidationError('validFrom harus sebelum validUntil.');
    }
    // Fix 1: this repo has no overnight-window support yet (e.g. 22:00-02:00) — a rule
    // created with startTime >= endTime would silently never match (hhmm can never be both
    // >= startTime and <= endTime across midnight), so reject it loudly at creation instead.
    if (data.startTime != null && data.endTime != null && data.startTime >= data.endTime) {
      throw new PromoRuleValidationError(
        'startTime harus sebelum endTime — jendela yang melewati tengah malam belum didukung.',
      );
    }
    // Fix 1: minQty > maxQty would make the quantity window impossible to satisfy — reject
    // at creation rather than ship a rule that can never fire.
    if (data.minQty != null && data.maxQty != null && data.minQty > data.maxQty) {
      throw new PromoRuleValidationError('minQty tidak boleh lebih besar dari maxQty.');
    }
    switch (data.kind) {
      case 'SPECIAL_PRICE':
        if (data.specialPrice == null) {
          throw new PromoRuleValidationError('specialPrice wajib diisi untuk SPECIAL_PRICE.');
        }
        break;
      case 'BUY_X_GET_Y':
        if (data.buyQty == null || data.getQty == null) {
          throw new PromoRuleValidationError('buyQty dan getQty wajib diisi untuk BUY_X_GET_Y.');
        }
        break;
      case 'SHIPPING_DISCOUNT':
        if (data.shippingFeeOverride == null) {
          throw new PromoRuleValidationError(
            'shippingFeeOverride wajib diisi untuk SHIPPING_DISCOUNT.',
          );
        }
        // I-5: evaluateShipping always matches against a synthetic line with quantity: 1, so
        // any minQty > 1 (or a maxQty) could never fire and would silently disable the rule.
        if ((data.minQty != null && data.minQty > 1) || data.maxQty != null) {
          throw new PromoRuleValidationError(
            'minQty/maxQty tidak didukung untuk SHIPPING_DISCOUNT — kuantitas galon tidak diperiksa pada level ini.',
          );
        }
        // D-2 (same defect class as I-5): evaluateShipping's synthetic line also has
        // productId: '' and categoryId: null, so a rule scoped to a product or category
        // could never match it either — permanently dead on creation.
        if (data.productId != null || data.categoryId != null) {
          throw new PromoRuleValidationError(
            'productId/categoryId tidak didukung untuk SHIPPING_DISCOUNT — berlaku di level pengiriman, bukan per produk.',
          );
        }
        break;
      case 'PERCENTAGE_OFF':
        if (data.percentOff == null || data.percentOff < 1 || data.percentOff > 99) {
          throw new PromoRuleValidationError('percentOff wajib diisi (1-99) untuk PERCENTAGE_OFF.');
        }
        break;
      case 'ORDER_DISCOUNT': {
        if (data.minSubtotal == null || data.minSubtotal < 0) {
          throw new PromoRuleValidationError('minSubtotal wajib diisi untuk ORDER_DISCOUNT.');
        }
        const hasAmount = data.discountAmount != null;
        const hasPercent = data.percentOff != null;
        if (hasAmount === hasPercent) {
          throw new PromoRuleValidationError(
            'ORDER_DISCOUNT butuh tepat satu: discountAmount ATAU percentOff.',
          );
        }
        if (hasAmount && (data.discountAmount as number) < 1) {
          throw new PromoRuleValidationError('discountAmount harus lebih dari 0.');
        }
        if (hasPercent && ((data.percentOff as number) < 1 || (data.percentOff as number) > 99)) {
          throw new PromoRuleValidationError('percentOff harus 1-99.');
        }
        // Order level, like SHIPPING_DISCOUNT: evaluateOrderDiscount matches a synthetic line of
        // quantity 1 with no product, so these could never fire and would silently disable it.
        if ((data.minQty != null && data.minQty > 1) || data.maxQty != null) {
          throw new PromoRuleValidationError('minQty/maxQty tidak didukung untuk ORDER_DISCOUNT.');
        }
        if (data.productId != null || data.categoryId != null) {
          throw new PromoRuleValidationError(
            'productId/categoryId tidak didukung untuk ORDER_DISCOUNT — berlaku untuk seluruh pesanan.',
          );
        }
        break;
      }
      case 'BUNDLE_GIFT':
        if (data.buyQty == null || data.getQty == null || data.buyQty < 1 || data.getQty < 1) {
          throw new PromoRuleValidationError('buyQty dan getQty (minimal 1) wajib diisi untuk BUNDLE_GIFT.');
        }
        if (data.giftProductId == null) {
          throw new PromoRuleValidationError('giftProductId wajib diisi untuk BUNDLE_GIFT.');
        }
        // Same product as the one bought is BUY_X_GET_Y, and keeping the two apart keeps the
        // stock arithmetic (and the receipt) honest about which is which.
        if (data.productId != null && data.productId === data.giftProductId) {
          throw new PromoRuleValidationError(
            'Hadiah harus produk yang berbeda — untuk produk yang sama pakai BUY_X_GET_Y.',
          );
        }
        break;
      default:
        break;
    }
  }
}
