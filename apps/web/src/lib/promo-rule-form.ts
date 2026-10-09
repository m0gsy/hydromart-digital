import type { PromoRule, PromoRuleChannel, PromoRuleKind, PromoRulePayload } from './types';

/*
 * The promo-rule editor's form model, shared by /hq/promo-rules and /dashboard/promo-rules.
 *
 * The two pages used to carry a copy each, and a third kind meant six places to keep in step.
 * What differs between them is only where the depot comes from (the HQ form lets you choose, the
 * depot console pins it), so that is the one argument `ruleFormToPayload` takes.
 */

/** ORDER_DISCOUNT takes either a fixed amount or a percent of the order, never both. */
export type OrderDiscountMode = 'AMOUNT' | 'PERCENT';

export interface RuleForm {
  name: string;
  kind: PromoRuleKind;
  depotId: string;
  productId: string;
  categoryId: string;
  specialPrice: string;
  buyQty: string;
  getQty: string;
  shippingFeeOverride: string;
  /** PERCENTAGE_OFF, and ORDER_DISCOUNT in PERCENT mode. */
  percentOff: string;
  minSubtotal: string;
  discountAmount: string;
  orderMode: OrderDiscountMode;
  giftProductId: string;
  firstOrderOnly: boolean;
  validFrom: string;
  validUntil: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  minQty: string;
  maxQty: string;
  channels: PromoRuleChannel[];
  active: boolean;
}

export const EMPTY_RULE_FORM: RuleForm = {
  name: '',
  kind: 'SPECIAL_PRICE',
  depotId: '',
  productId: '',
  categoryId: '',
  specialPrice: '',
  buyQty: '',
  getQty: '',
  shippingFeeOverride: '',
  percentOff: '',
  minSubtotal: '',
  discountAmount: '',
  orderMode: 'AMOUNT',
  giftProductId: '',
  firstOrderOnly: false,
  validFrom: '',
  validUntil: '',
  daysOfWeek: [],
  startTime: '',
  endTime: '',
  minQty: '1',
  maxQty: '',
  channels: [],
  active: true,
};

/**
 * Kinds that act on the order or its delivery rather than on a product line. They have no
 * product, category or quantity to match, and the server refuses those fields, so the form does
 * not offer them.
 */
export const isOrderLevelKind = (kind: PromoRuleKind): boolean =>
  kind === 'SHIPPING_DISCOUNT' || kind === 'ORDER_DISCOUNT';

const str = (n: number | null | undefined): string => (n != null ? String(n) : '');

export function ruleFormFrom(r: PromoRule): RuleForm {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  return {
    name: r.name,
    kind: r.kind,
    depotId: r.depotId ?? '',
    productId: r.productId ?? '',
    categoryId: r.categoryId ?? '',
    specialPrice: str(r.specialPrice),
    buyQty: str(r.buyQty),
    getQty: str(r.getQty),
    shippingFeeOverride: str(r.shippingFeeOverride),
    percentOff: str(r.percentOff),
    minSubtotal: str(r.minSubtotal),
    discountAmount: str(r.discountAmount),
    // A rule saved with a percent (and no amount) reopens in percent mode.
    orderMode: r.kind === 'ORDER_DISCOUNT' && r.discountAmount == null && r.percentOff != null ? 'PERCENT' : 'AMOUNT',
    giftProductId: r.giftProductId ?? '',
    firstOrderOnly: r.firstOrderOnly === true,
    validFrom: day(r.validFrom),
    validUntil: day(r.validUntil),
    daysOfWeek: r.daysOfWeek,
    startTime: r.startTime ?? '',
    endTime: r.endTime ?? '',
    minQty: String(r.minQty),
    maxQty: str(r.maxQty),
    channels: r.channels,
    active: r.active,
  };
}

/**
 * The create / patch body. A field that does not belong to the chosen kind is sent as null, so
 * switching a rule's kind in the editor cannot leave the old kind's number behind.
 */
export function ruleFormToPayload(
  f: RuleForm,
  depotId: string | null,
  mode: 'create' | 'edit' = 'create',
): PromoRulePayload {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  const numOrNull = (s: string) => (s.trim() ? Number(s) : null);
  const dateOrNull = (s: string) => (s ? new Date(s).toISOString() : null);
  const orderLevel = isOrderLevelKind(f.kind);
  const orderPercent = f.kind === 'ORDER_DISCOUNT' && f.orderMode === 'PERCENT';
  const orderAmount = f.kind === 'ORDER_DISCOUNT' && f.orderMode === 'AMOUNT';
  return {
    name: f.name.trim(),
    kind: f.kind,
    depotId,
    productId: orderLevel ? null : orNull(f.productId),
    categoryId: orderLevel ? null : orNull(f.categoryId),
    specialPrice: f.kind === 'SPECIAL_PRICE' ? numOrNull(f.specialPrice) : null,
    buyQty: f.kind === 'BUY_X_GET_Y' || f.kind === 'BUNDLE_GIFT' ? numOrNull(f.buyQty) : null,
    getQty: f.kind === 'BUY_X_GET_Y' || f.kind === 'BUNDLE_GIFT' ? numOrNull(f.getQty) : null,
    shippingFeeOverride: f.kind === 'SHIPPING_DISCOUNT' ? numOrNull(f.shippingFeeOverride) : null,
    percentOff: f.kind === 'PERCENTAGE_OFF' || orderPercent ? numOrNull(f.percentOff) : null,
    minSubtotal: f.kind === 'ORDER_DISCOUNT' ? numOrNull(f.minSubtotal) : null,
    discountAmount: orderAmount ? numOrNull(f.discountAmount) : null,
    giftProductId: f.kind === 'BUNDLE_GIFT' ? orNull(f.giftProductId) : null,
    firstOrderOnly: f.firstOrderOnly,
    validFrom: dateOrNull(f.validFrom),
    validUntil: dateOrNull(f.validUntil),
    daysOfWeek: f.daysOfWeek,
    startTime: orNull(f.startTime),
    endTime: orNull(f.endTime),
    // The server refuses a quantity window on an order-level kind (it would never match).
    minQty: orderLevel ? 1 : Number(f.minQty) || 1,
    maxQty: orderLevel ? null : numOrNull(f.maxQty),
    channels: f.channels,
    // `active` is a PATCH field only: promo-service's create DTO forbids it (a new rule is born
    // active), and the validation pipe turns an unknown property into a 400. The editor sent it
    // on create from the day it shipped, so no rule could ever be created through the form; every
    // test mocked the API, which does not run the DTO.
    ...(mode === 'edit' ? { active: f.active } : {}),
  };
}

/** The dictionary key (under `<ns>.promoRules`) of the first thing wrong, or null. */
export type RuleFormError = 'needName' | 'needPercent' | 'needOrderDiscount' | 'needGift' | 'giftSameProduct';

/**
 * Catches the mistakes worth naming before a round trip. The server stays the authority: it
 * repeats every one of these checks and more.
 */
export function validateRuleForm(f: RuleForm): RuleFormError | null {
  if (!f.name.trim()) return 'needName';
  const whole = (s: string) => /^\d+$/.test(s.trim());
  const percentOk = (s: string) => whole(s) && Number(s) >= 1 && Number(s) <= 99;
  if (f.kind === 'PERCENTAGE_OFF' && !percentOk(f.percentOff)) return 'needPercent';
  if (f.kind === 'ORDER_DISCOUNT') {
    if (!whole(f.minSubtotal)) return 'needOrderDiscount';
    if (f.orderMode === 'PERCENT' ? !percentOk(f.percentOff) : !(whole(f.discountAmount) && Number(f.discountAmount) >= 1)) {
      return 'needOrderDiscount';
    }
  }
  if (f.kind === 'BUNDLE_GIFT') {
    if (!(whole(f.buyQty) && Number(f.buyQty) >= 1 && whole(f.getQty) && Number(f.getQty) >= 1) || !f.giftProductId) {
      return 'needGift';
    }
    if (f.productId && f.productId === f.giftProductId) return 'giftSameProduct';
  }
  return null;
}
