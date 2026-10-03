import { Inject, Injectable } from '@nestjs/common';

import {
  CartLine,
  EvaluationContext,
  LineResult,
  PromoRuleChannel,
  ShippingResult,
  evaluateLine,
  evaluateShipping,
} from '../../domain/promo-rule';
import { PromoRuleNotFoundError } from '../../domain/errors';
import {
  CreatePromoRuleData,
  PromoRuleRecord,
  PromoRuleRepository,
  UpdatePromoRuleData,
} from '../ports/promo-rule.repository';
import { PROMO_TOKENS } from '../tokens';

/** Default business time zone for schedule matching until a per-depot override exists. */
const TIME_ZONE = 'Asia/Jakarta';

export class PromoRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromoRuleValidationError';
  }
}

export interface QuoteInput {
  depotId: string | null;
  channel: PromoRuleChannel;
  occurredAt: Date;
  lines: CartLine[];
}

export interface QuoteOutput {
  lines: LineResult[];
  shipping: ShippingResult;
}

export interface ApplyInput extends QuoteInput {
  orderId: string;
}

@Injectable()
export class PromoRuleService {
  constructor(
    @Inject(PROMO_TOKENS.PromoRuleRepository) private readonly repo: PromoRuleRepository,
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

  async update(id: string, patch: UpdatePromoRuleData): Promise<PromoRuleRecord> {
    const current = await this.findById(id);
    this.validate({ ...current, ...patch });
    return this.repo.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repo.delete(id);
  }

  async quote(input: QuoteInput): Promise<QuoteOutput> {
    const candidates = await this.repo.findActiveCandidates(
      input.depotId ? [input.depotId] : undefined,
      input.occurredAt,
    );
    const ctx: EvaluationContext = {
      channel: input.channel,
      occurredAt: input.occurredAt,
      timeZone: TIME_ZONE,
    };
    return {
      lines: input.lines.map((line) => evaluateLine(candidates, line, ctx)),
      shipping: evaluateShipping(candidates, ctx),
    };
  }

  /**
   * Re-evaluates and persists `PromoApplication` rows for an order already created.
   * Idempotent per `orderId`: a second call for the same order is a no-op, mirroring how
   * `VoucherService.redeem` is idempotent per order. Records one row per line whose
   * `appliedRuleIds` is non-empty (attributed to the first rule id — SPECIAL_PRICE, if it
   * won, is always first; see `evaluateLine`) and one row for the shipping winner, if any.
   *
   * `discountValue` is computed against the *original* cart line, not the quote result alone:
   * `LineResult` carries `unitPriceAfter`/`lineTotal` but not the original `unitPrice`, so the
   * saved-price portion is `(original.unitPrice - unitPriceAfter) * original.quantity`. Free
   * units from a stacked BUY_X_GET_Y add `freeQty * original.unitPrice` — the giveaway's value
   * at the line's normal price (never tested with a stacked rule; see the plan's Task 5 if this
   * needs to change).
   */
  async apply(input: ApplyInput): Promise<void> {
    if (await this.repo.hasApplicationFor(input.orderId)) return;

    const { lines, shipping } = await this.quote(input);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.appliedRuleIds.length === 0) continue;
      const original = input.lines[i];
      const discountValue =
        (original.unitPrice - line.unitPriceAfter) * original.quantity +
        line.freeQty * original.unitPrice;
      await this.repo.recordApplication({
        orderId: input.orderId,
        promoRuleId: line.appliedRuleIds[0],
        productId: line.productId,
        discountValue,
      });
    }
    if (shipping.appliedRuleId) {
      await this.repo.recordApplication({
        orderId: input.orderId,
        promoRuleId: shipping.appliedRuleId,
        productId: null,
        discountValue: shipping.shippingFeeOverride ?? 0,
      });
    }
  }

  private validate(data: Partial<CreatePromoRuleData>): void {
    if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
      throw new PromoRuleValidationError('validFrom harus sebelum validUntil.');
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
        break;
      default:
        break;
    }
  }
}
