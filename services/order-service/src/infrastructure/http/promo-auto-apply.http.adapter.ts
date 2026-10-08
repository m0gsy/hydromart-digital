import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import {
  AutoApplyApplyInput,
  AutoApplyCartLine,
  AutoApplyChannel,
  AutoApplyQuoteResult,
  PromoAutoApplyPort,
} from '../../application/ports/promo-auto-apply.port';

const EMPTY_QUOTE: AutoApplyQuoteResult = {
  lines: [],
  shippingAppliedRuleId: null,
  shippingFeeOverride: null,
};

@Injectable()
export class PromoAutoApplyHttpAdapter implements PromoAutoApplyPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(PromoAutoApplyHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async quote(
    depotId: string | null,
    channel: AutoApplyChannel,
    lines: AutoApplyCartLine[],
  ): Promise<AutoApplyQuoteResult> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn('Auto-apply promo quote skipped: no internal service key');
      return EMPTY_QUOTE;
    }
    try {
      const res = await fetch(`${this.config.promoServiceUrl}/api/v1/promotions/auto-apply/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          depotId,
          channel,
          lines: lines.map((l) => ({
            productId: l.productId,
            categoryId: l.categoryId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        }),
        signal: AbortSignal.timeout(PromoAutoApplyHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Auto-apply promo quote responded ${res.status}`);
        return EMPTY_QUOTE;
      }
      const body = (await res.json()) as AutoApplyQuoteResult;
      return {
        lines: body.lines ?? [],
        shippingAppliedRuleId: body.shippingAppliedRuleId ?? null,
        shippingFeeOverride: body.shippingFeeOverride ?? null,
      };
    } catch (error) {
      this.logger.warn(`Auto-apply promo quote unreachable: ${(error as Error).message}`);
      return EMPTY_QUOTE;
    }
  }

  async apply(input: AutoApplyApplyInput): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn(`Auto-apply promo record skipped for order ${input.orderId}: no internal service key`);
      return;
    }
    try {
      // Sent verbatim — this service already acted on this exact quote() result, so
      // promo-service's apply() trusts it rather than re-deriving pricing (Plan 1).
      const res = await fetch(`${this.config.promoServiceUrl}/api/v1/promotions/auto-apply/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          orderId: input.orderId,
          lines: input.lines.map((l) => ({
            productId: l.productId,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            appliedRuleIds: l.appliedRuleIds,
            unitPriceAfter: l.unitPriceAfter,
            freeQty: l.freeQty,
          })),
          shippingAppliedRuleId: input.shippingAppliedRuleId ?? undefined,
          shippingFeeOverride: input.shippingFeeOverride ?? undefined,
          originalShippingFee: input.originalShippingFee ?? undefined,
          shippingUnits: input.shippingUnits ?? undefined,
        }),
        signal: AbortSignal.timeout(PromoAutoApplyHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Auto-apply promo record failed for order ${input.orderId}: responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Auto-apply promo record failed for order ${input.orderId}: ${(error as Error).message}`);
    }
  }
}
