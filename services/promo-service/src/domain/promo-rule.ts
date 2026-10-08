// Pure matching/stacking logic for auto-apply promo rules (item 5 fase 1). No database, no
// I/O — PromoRuleService (application layer) supplies the candidate rows and calls these.

export type PromoRuleKind =
  | 'SPECIAL_PRICE'
  | 'BUY_X_GET_Y'
  | 'SHIPPING_DISCOUNT'
  | 'PERCENTAGE_OFF'
  | 'ORDER_DISCOUNT'
  | 'BUNDLE_GIFT';
export type PromoRuleChannel = 'APP' | 'COUNTER';

/** The subset of a `PromoRule` row the matching/stacking algorithm needs. */
export interface PromoRuleCandidate {
  id: string;
  name: string;
  kind: PromoRuleKind;
  depotId: string | null;
  productId: string | null;
  categoryId: string | null;
  specialPrice: number | null;
  buyQty: number | null;
  getQty: number | null;
  shippingFeeOverride: number | null;
  /** PERCENTAGE_OFF: percent (1..99) off the unit price. ORDER_DISCOUNT: alternative to discountAmount. */
  percentOff: number | null;
  /** ORDER_DISCOUNT: the post-item-promo subtotal at which the discount starts. */
  minSubtotal: number | null;
  /** ORDER_DISCOUNT: rupiah off the order. */
  discountAmount: number | null;
  /** BUNDLE_GIFT: the different product handed over free. */
  giftProductId: string | null;
  /** Any kind: only for a customer with no earlier active/completed order. */
  firstOrderOnly: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  minQty: number;
  maxQty: number | null;
  channels: PromoRuleChannel[];
}

export interface CartLine {
  productId: string;
  categoryId: string | null;
  quantity: number;
  unitPrice: number;
  /**
   * A wholesale-band line: already the depot's lowest price, so no promo touches it, but it
   * still counts towards the order subtotal an ORDER_DISCOUNT is judged on.
   */
  skipPromo?: boolean;
}

export interface EvaluationContext {
  channel: PromoRuleChannel;
  /** Server time the order is being priced at — never trust a client-supplied clock. */
  occurredAt: Date;
  /** IANA zone the depot's day/time-of-day fields are interpreted in. */
  timeZone: string;
  /** The depot this cart is being priced for, or null for a network-wide (no-depot) quote. */
  depotId: string | null;
  /** True when the customer has no earlier active/completed order. Absent = false. */
  firstOrder?: boolean;
}

export interface LineResult {
  productId: string;
  appliedRuleIds: string[];
  unitPriceAfter: number;
  freeQty: number;
  lineTotal: number;
}

/** A free product handed over because a BUNDLE_GIFT rule matched the line that triggers it. */
export interface GiftResult {
  promoRuleId: string;
  /** The gift product (NOT the product that triggered it). */
  productId: string;
  quantity: number;
  triggerProductId: string;
}

export interface OrderDiscountResult {
  appliedRuleId: string | null;
  /** Rupiah off the order; 0 when no rule applied. */
  amount: number;
}

export interface ShippingResult {
  appliedRuleId: string | null;
  shippingFeeOverride: number | null;
}

/** `occurredAt`'s local day-of-week (0=Minggu..6=Sabtu) and "HH:mm" in `timeZone`. */
function localDayAndTime(occurredAt: Date, timeZone: string): { day: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(occurredAt);
  const weekdayShort = parts.find((p) => p.type === 'weekday')!.value;
  const hour = parts.find((p) => p.type === 'hour')!.value.padStart(2, '0');
  const minute = parts.find((p) => p.type === 'minute')!.value.padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { day: days.indexOf(weekdayShort), hhmm: `${hour === '24' ? '00' : hour}:${minute}` };
}

/** True when a rule's filters (scope, schedule, channel, qty) all match a cart line. */
export function ruleMatchesLine(
  rule: PromoRuleCandidate,
  line: CartLine,
  ctx: EvaluationContext,
): boolean {
  // Defense in depth: the repository is expected to pre-filter candidates to the caller's
  // depot or network-wide, but this layer stays correct on its own rather than trusting that
  // blindly (mirrors how Voucher's domain-level validation does its own checks).
  if (rule.depotId !== null && rule.depotId !== ctx.depotId) return false;
  if (rule.productId !== null && rule.productId !== line.productId) return false;
  if (rule.productId === null && rule.categoryId !== null && rule.categoryId !== line.categoryId) {
    return false;
  }
  if (rule.validFrom !== null && rule.validFrom > ctx.occurredAt) return false;
  if (rule.validUntil !== null && rule.validUntil < ctx.occurredAt) return false;

  const { day, hhmm } = localDayAndTime(ctx.occurredAt, ctx.timeZone);
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(day)) return false;
  if (rule.startTime !== null && hhmm < rule.startTime) return false;
  // Inclusive of the end minute by design, not a bug: ctx only carries "HH:mm" (no seconds),
  // so a rule ending at "12:00" matches any instant inside that minute, e.g. 12:00:59.
  if (rule.endTime !== null && hhmm > rule.endTime) return false;

  if (rule.channels.length > 0 && !rule.channels.includes(ctx.channel)) return false;
  // "Pelanggan baru": a customer we cannot show to be new is treated as not new.
  if (rule.firstOrderOnly && ctx.firstOrder !== true) return false;

  if (line.quantity < rule.minQty) return false;
  if (rule.maxQty !== null && line.quantity > rule.maxQty) return false;

  return true;
}

/** BUY_X_GET_Y free-unit count: floor(quantity / buyQty) * getQty. */
function freeQtyFor(rule: PromoRuleCandidate, quantity: number): number {
  if (rule.buyQty === null || rule.getQty === null || rule.buyQty <= 0) return 0;
  return Math.floor(quantity / rule.buyQty) * rule.getQty;
}

/**
 * Resolves one product line: matches candidates, picks a winner per kind (most beneficial
 * to the customer), stacks SPECIAL_PRICE with BUY_X_GET_Y when both match.
 */
export function evaluateLine(
  candidates: PromoRuleCandidate[],
  line: CartLine,
  ctx: EvaluationContext,
): LineResult {
  if (line.skipPromo) {
    return {
      productId: line.productId,
      appliedRuleIds: [],
      unitPriceAfter: line.unitPrice,
      freeQty: 0,
      lineTotal: line.unitPrice * line.quantity,
    };
  }
  const matching = candidates.filter((r) => ruleMatchesLine(r, line, ctx));

  // SPECIAL_PRICE and PERCENTAGE_OFF are the same thing to the customer (a lower unit price),
  // so they compete in one group and the lowest resulting price wins.
  const priceOffers: { id: string; price: number }[] = [];
  for (const r of matching) {
    if (r.kind === 'SPECIAL_PRICE' && r.specialPrice !== null && r.specialPrice < line.unitPrice) {
      priceOffers.push({ id: r.id, price: r.specialPrice });
    } else if (r.kind === 'PERCENTAGE_OFF' && r.percentOff !== null) {
      // Never below Rp1: order-service reads unitPrice 0 as a free BOGO row. A rule that
      // cannot lower the price (a Rp1 item) is simply not an offer.
      const price = Math.max(1, Math.round((line.unitPrice * (100 - r.percentOff)) / 100));
      if (price < line.unitPrice) priceOffers.push({ id: r.id, price });
    }
  }
  const bogoCandidates = matching.filter((r) => r.kind === 'BUY_X_GET_Y');

  let unitPriceAfter = line.unitPrice;
  const appliedRuleIds: string[] = [];

  if (priceOffers.length > 0) {
    const winner = priceOffers.reduce((best, o) => (o.price < best.price ? o : best));
    unitPriceAfter = winner.price;
    appliedRuleIds.push(winner.id);
  }

  let freeQty = 0;
  if (bogoCandidates.length > 0) {
    const winner = bogoCandidates.reduce((best, r) =>
      freeQtyFor(r, line.quantity) > freeQtyFor(best, line.quantity) ? r : best,
    );
    freeQty = freeQtyFor(winner, line.quantity);
    if (freeQty > 0) appliedRuleIds.push(winner.id);
  }

  return {
    productId: line.productId,
    appliedRuleIds,
    unitPriceAfter,
    freeQty,
    lineTotal: unitPriceAfter * line.quantity,
  };
}

/**
 * BUNDLE_GIFT: the line that triggers a bundle hands over `floor(quantity / buyQty) * getQty`
 * of a DIFFERENT product. One winner per line (the biggest gift); several lines can each win
 * their own. A gift is a separate delivery, so it is returned beside the line results rather
 * than inside them: the positional line contract `apply()` relies on stays untouched.
 */
export function evaluateGifts(
  candidates: PromoRuleCandidate[],
  lines: CartLine[],
  ctx: EvaluationContext,
): GiftResult[] {
  const gifts: GiftResult[] = [];
  for (const line of lines) {
    if (line.skipPromo) continue;
    const offers = candidates
      .filter(
        (r) => r.kind === 'BUNDLE_GIFT' && r.giftProductId !== null && ruleMatchesLine(r, line, ctx),
      )
      .map((r) => ({ rule: r, quantity: freeQtyFor(r, line.quantity) }))
      .filter((o) => o.quantity > 0);
    if (offers.length === 0) continue;
    const winner = offers.reduce((best, o) => (o.quantity > best.quantity ? o : best));
    gifts.push({
      promoRuleId: winner.rule.id,
      productId: winner.rule.giftProductId as string,
      quantity: winner.quantity,
      triggerProductId: line.productId,
    });
  }
  return gifts;
}

/**
 * ORDER_DISCOUNT: once the order subtotal (after item promos) reaches `minSubtotal`, take a
 * fixed amount or a percent off it. The biggest discount wins; never more than the subtotal.
 */
export function evaluateOrderDiscount(
  candidates: PromoRuleCandidate[],
  ctx: EvaluationContext,
  subtotal: number,
): OrderDiscountResult {
  // Same trick as evaluateShipping: schedule / channel / depot / first-order checks reuse
  // ruleMatchesLine with a synthetic line. validate() rejects product, category and quantity
  // limits on ORDER_DISCOUNT, so the synthetic line can never be the thing that fails.
  const anyLine: CartLine = { productId: '', categoryId: null, quantity: 1, unitPrice: 0 };
  let best: { id: string; amount: number } | null = null;
  for (const r of candidates) {
    if (r.kind !== 'ORDER_DISCOUNT' || !ruleMatchesLine(r, anyLine, ctx)) continue;
    if (r.minSubtotal === null || subtotal < r.minSubtotal) continue;
    const raw =
      r.discountAmount !== null
        ? r.discountAmount
        : r.percentOff !== null
          ? Math.round((subtotal * r.percentOff) / 100)
          : 0;
    const amount = Math.min(raw, subtotal);
    if (amount > 0 && (best === null || amount > best.amount)) best = { id: r.id, amount };
  }
  return best ? { appliedRuleId: best.id, amount: best.amount } : { appliedRuleId: null, amount: 0 };
}

/** Resolves the order-level shipping override: lowest `shippingFeeOverride` wins. */
export function evaluateShipping(
  candidates: PromoRuleCandidate[],
  ctx: EvaluationContext,
): ShippingResult {
  // Shipping rules have no product line to match against; reuse the schedule/channel/depot
  // checks with a synthetic line of productId: '', categoryId: null, quantity: 1. That line
  // only ever satisfies product/category scoping when the rule itself has none — qty: 1
  // is safe because validate() rejects minQty > 1 / any maxQty for SHIPPING_DISCOUNT (I-5),
  // and product/category scope is safe because validate() separately rejects a non-null
  // productId or categoryId on SHIPPING_DISCOUNT (D-2) — so any SHIPPING_DISCOUNT candidate
  // reaching this function is guaranteed unscoped on all three axes already.
  const anyLine: CartLine = { productId: '', categoryId: null, quantity: 1, unitPrice: 0 };
  const matching = candidates.filter(
    (r) => r.kind === 'SHIPPING_DISCOUNT' && r.shippingFeeOverride !== null && ruleMatchesLine(r, anyLine, ctx),
  );
  if (matching.length === 0) return { appliedRuleId: null, shippingFeeOverride: null };
  const winner = matching.reduce((best, r) =>
    (r.shippingFeeOverride as number) < (best.shippingFeeOverride as number) ? r : best,
  );
  return { appliedRuleId: winner.id, shippingFeeOverride: winner.shippingFeeOverride };
}
