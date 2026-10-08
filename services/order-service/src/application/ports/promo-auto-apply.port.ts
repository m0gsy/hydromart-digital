/**
 * Talks to promo-service's auto-apply engine (item 5 fase 1, see
 * docs/superpowers/specs/2026-10-02-promo-auto-apply-engine-design.md). Unlike `PromoPort`
 * (customer-typed voucher codes, fails CLOSED), this is a BACKGROUND pricing optimization —
 * nothing the customer typed, nothing they are promised by name at the point of checkout —
 * so both methods fail OPEN: an unreachable or erroring promo-service must never block a
 * checkout, it must simply mean no auto-promo was applied.
 */
export type AutoApplyChannel = 'APP' | 'COUNTER';

export interface AutoApplyCartLine {
  productId: string;
  categoryId: string | null;
  quantity: number;
  unitPrice: number;
  /** A wholesale-band line: no promo touches it, but it counts to the order subtotal. */
  skipPromo?: boolean;
}

export interface AutoApplyLineResult {
  productId: string;
  appliedRuleIds: string[];
  unitPriceAfter: number;
  freeQty: number;
  lineTotal: number;
}

/** A free product a BUNDLE_GIFT rule earned. Whether it can be delivered is the caller's call. */
export interface AutoApplyGift {
  promoRuleId: string;
  productId: string;
  quantity: number;
  triggerProductId: string;
}

export interface AutoApplyQuoteResult {
  lines: AutoApplyLineResult[];
  shippingAppliedRuleId: string | null;
  shippingFeeOverride: number | null;
  /**
   * ORDER_DISCOUNT: rupiah off the order, judged on the subtotal after item promos. Optional
   * so an older promo-service (which sends neither field) reads as "none".
   */
  orderDiscountRuleId?: string | null;
  orderDiscountAmount?: number;
  gifts?: AutoApplyGift[];
}

/** One cart line as it was ORIGINALLY priced, plus what a prior `quote()` call decided for it. */
export interface AutoApplyAppliedLine {
  productId: string;
  unitPrice: number;
  quantity: number;
  appliedRuleIds: string[];
  unitPriceAfter: number;
  freeQty: number;
}

export interface AutoApplyApplyInput {
  orderId: string;
  lines: AutoApplyAppliedLine[];
  shippingAppliedRuleId?: string | null;
  shippingFeeOverride?: number | null;
  /** The depot's own per-galon fee, before any override — promo-service never learns this
   *  on its own, so the caller (this service) must supply it to get a correct discount. */
  originalShippingFee?: number | null;
  /** Galon count the shipping fee applies across. Required whenever `originalShippingFee`
   *  is set — promo-service rejects the shipping row rather than guess a default. */
  shippingUnits?: number | null;
  /** The ORDER_DISCOUNT that applied, and the rupiah actually taken off. */
  orderDiscountRuleId?: string | null;
  orderDiscountAmount?: number;
  /** Gifts the order really carries (a gift that could not be delivered is not listed). */
  gifts?: { promoRuleId: string; productId: string; value: number }[];
}

export interface PromoAutoApplyPort {
  /** Never throws. Returns a neutral result (no line touched) on any failure. */
  quote(
    depotId: string | null,
    channel: AutoApplyChannel,
    lines: AutoApplyCartLine[],
    /** True when the customer has no earlier active/completed order ("pelanggan baru"). */
    firstOrder?: boolean,
  ): Promise<AutoApplyQuoteResult>;

  /**
   * Records the audit trail for an order already created, FROM the exact `quote()` result
   * this service already acted on — mirrors promo-service's own `apply()` contract, which
   * trusts the caller's priced result rather than re-deriving it (a prior re-derive design
   * had a drift risk and could not compute a correct shipping discount; see Plan 1). Never
   * throws — a failure here only means `PromoApplication` rows are missing for this order,
   * never that the order itself is wrong. The price was already locked in by `quote`.
   */
  apply(input: AutoApplyApplyInput): Promise<void>;
}
