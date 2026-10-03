// Pure matching/stacking logic for auto-apply promo rules (item 5 fase 1). No database, no
// I/O — PromoRuleService (application layer) supplies the candidate rows and calls these.

export type PromoRuleKind = 'SPECIAL_PRICE' | 'BUY_X_GET_Y' | 'SHIPPING_DISCOUNT';
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
}

export interface EvaluationContext {
  channel: PromoRuleChannel;
  /** Server time the order is being priced at — never trust a client-supplied clock. */
  occurredAt: Date;
  /** IANA zone the depot's day/time-of-day fields are interpreted in. */
  timeZone: string;
  /** The depot this cart is being priced for, or null for a network-wide (no-depot) quote. */
  depotId: string | null;
}

export interface LineResult {
  productId: string;
  appliedRuleIds: string[];
  unitPriceAfter: number;
  freeQty: number;
  lineTotal: number;
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
  const matching = candidates.filter((r) => ruleMatchesLine(r, line, ctx));

  const specialPriceCandidates = matching.filter(
    (r): r is PromoRuleCandidate & { specialPrice: number } =>
      r.kind === 'SPECIAL_PRICE' && r.specialPrice !== null && r.specialPrice < line.unitPrice,
  );
  const bogoCandidates = matching.filter((r) => r.kind === 'BUY_X_GET_Y');

  let unitPriceAfter = line.unitPrice;
  const appliedRuleIds: string[] = [];

  if (specialPriceCandidates.length > 0) {
    const winner = specialPriceCandidates.reduce((best, r) =>
      r.specialPrice < best.specialPrice ? r : best,
    );
    unitPriceAfter = winner.specialPrice;
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
