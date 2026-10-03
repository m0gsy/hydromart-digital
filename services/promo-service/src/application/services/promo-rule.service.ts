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
import { PromoConfigService } from '../../config/promo-config.service';
import { PROMO_TOKENS } from '../tokens';

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

  async update(id: string, patch: UpdatePromoRuleData): Promise<PromoRuleRecord> {
    const current = await this.findById(id);
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
    };
    return {
      lines: input.lines.map((line) => evaluateLine(candidates, line, ctx)),
      shipping: evaluateShipping(candidates, ctx),
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
      if (line.appliedRuleIds.length === 0) continue;

      // evaluateLine always pushes the SPECIAL_PRICE winner (if any) BEFORE the BUY_X_GET_Y
      // winner (if any) — see domain/promo-rule.ts. So: a price reduction, if present, is
      // ALWAYS appliedRuleIds[0]; a BOGO win, if present, is ALWAYS the LAST element — this
      // holds whether one or both kinds won, so don't destructure positionally as [a, b].
      const priceWon = original.unitPrice > line.unitPriceAfter;
      const bogoWon = line.freeQty > 0;

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

    if (input.quotedShipping.appliedRuleId && input.originalShippingFee != null) {
      rows.push({
        promoRuleId: input.quotedShipping.appliedRuleId,
        productId: null,
        discountValue: input.originalShippingFee - (input.quotedShipping.shippingFeeOverride ?? 0),
      });
    }

    if (rows.length === 0) return;
    await this.repo.recordApplications(input.orderId, rows);
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
