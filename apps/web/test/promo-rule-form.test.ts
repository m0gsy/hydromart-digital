import { describe, expect, it } from 'vitest';

import { en } from '@/lib/dictionaries/en';
import { id } from '@/lib/dictionaries/id';
import {
  EMPTY_RULE_FORM,
  type RuleForm,
  isOrderLevelKind,
  ruleFormFrom,
  ruleFormToPayload,
  validateRuleForm,
} from '@/lib/promo-rule-form';
import type { PromoRule } from '@/lib/types';

const form = (over: Partial<RuleForm> = {}): RuleForm => ({ ...EMPTY_RULE_FORM, name: 'Promo', ...over });

describe('ruleFormToPayload · every kind sends only its own fields', () => {
  it('PERCENTAGE_OFF sends the percent and nothing from other kinds', () => {
    const p = ruleFormToPayload(form({ kind: 'PERCENTAGE_OFF', percentOff: '15', specialPrice: '999', buyQty: '3' }), null);
    expect(p).toMatchObject({ kind: 'PERCENTAGE_OFF', percentOff: 15, specialPrice: null, buyQty: null, minSubtotal: null });
  });

  it('ORDER_DISCOUNT in AMOUNT mode sends the amount, never the percent', () => {
    const p = ruleFormToPayload(
      form({ kind: 'ORDER_DISCOUNT', minSubtotal: '100000', discountAmount: '10000', percentOff: '5', orderMode: 'AMOUNT' }),
      null,
    );
    expect(p).toMatchObject({ minSubtotal: 100000, discountAmount: 10000, percentOff: null });
  });

  it('ORDER_DISCOUNT in PERCENT mode sends the percent, never the amount', () => {
    const p = ruleFormToPayload(
      form({ kind: 'ORDER_DISCOUNT', minSubtotal: '100000', discountAmount: '10000', percentOff: '5', orderMode: 'PERCENT' }),
      null,
    );
    expect(p).toMatchObject({ minSubtotal: 100000, discountAmount: null, percentOff: 5 });
  });

  it('order-level kinds send no product, category or quantity window (the server refuses them)', () => {
    for (const kind of ['ORDER_DISCOUNT', 'SHIPPING_DISCOUNT'] as const) {
      const p = ruleFormToPayload(form({ kind, productId: 'p', categoryId: 'c', minQty: '5', maxQty: '9' }), null);
      expect(p).toMatchObject({ productId: null, categoryId: null, minQty: 1, maxQty: null });
    }
    expect(isOrderLevelKind('ORDER_DISCOUNT')).toBe(true);
    expect(isOrderLevelKind('BUNDLE_GIFT')).toBe(false);
  });

  it('BUNDLE_GIFT sends buy / get / gift product and keeps its trigger scope', () => {
    const p = ruleFormToPayload(
      form({ kind: 'BUNDLE_GIFT', buyQty: '2', getQty: '1', giftProductId: 'gift', productId: 'trigger' }),
      null,
    );
    expect(p).toMatchObject({ buyQty: 2, getQty: 1, giftProductId: 'gift', productId: 'trigger' });
  });

  it('switching kind leaves nothing of the old kind behind', () => {
    const p = ruleFormToPayload(form({ kind: 'SPECIAL_PRICE', specialPrice: '6000', giftProductId: 'gift', percentOff: '10' }), null);
    expect(p).toMatchObject({ specialPrice: 6000, giftProductId: null, percentOff: null, discountAmount: null });
  });

  it('carries firstOrderOnly and the depot it is given', () => {
    const p = ruleFormToPayload(form({ firstOrderOnly: true }), 'depot-a');
    expect(p).toMatchObject({ firstOrderOnly: true, depotId: 'depot-a' });
  });
});

describe('ruleFormToPayload · the active flag', () => {
  it('a CREATE never carries `active` (promo-service refuses it), an EDIT always does', () => {
    expect(ruleFormToPayload(form({ active: true }), null)).not.toHaveProperty('active');
    expect(ruleFormToPayload(form({ active: true }), null, 'create')).not.toHaveProperty('active');
    expect(ruleFormToPayload(form({ active: false }), null, 'edit')).toMatchObject({ active: false });
    expect(ruleFormToPayload(form({ active: true }), null, 'edit')).toMatchObject({ active: true });
  });
});

describe('validateRuleForm', () => {
  it.each([
    [form({ name: ' ' }), 'needName'],
    [form({ kind: 'PERCENTAGE_OFF', percentOff: '' }), 'needPercent'],
    [form({ kind: 'PERCENTAGE_OFF', percentOff: '100' }), 'needPercent'],
    [form({ kind: 'PERCENTAGE_OFF', percentOff: '0' }), 'needPercent'],
    [form({ kind: 'PERCENTAGE_OFF', percentOff: '12.5' }), 'needPercent'],
    [form({ kind: 'ORDER_DISCOUNT', discountAmount: '1000' }), 'needOrderDiscount'],
    [form({ kind: 'ORDER_DISCOUNT', minSubtotal: '1000' }), 'needOrderDiscount'],
    [form({ kind: 'ORDER_DISCOUNT', minSubtotal: '1000', orderMode: 'PERCENT', percentOff: '100' }), 'needOrderDiscount'],
    [form({ kind: 'BUNDLE_GIFT', buyQty: '2', getQty: '1' }), 'needGift'],
    [form({ kind: 'BUNDLE_GIFT', buyQty: '0', getQty: '1', giftProductId: 'g' }), 'needGift'],
    [form({ kind: 'BUNDLE_GIFT', buyQty: '2', getQty: '1', giftProductId: 'same', productId: 'same' }), 'giftSameProduct'],
  ] as const)('flags %#', (f, expected) => {
    expect(validateRuleForm(f)).toBe(expected);
  });

  it('passes complete forms of every kind', () => {
    expect(validateRuleForm(form())).toBeNull();
    expect(validateRuleForm(form({ kind: 'PERCENTAGE_OFF', percentOff: '99' }))).toBeNull();
    expect(validateRuleForm(form({ kind: 'ORDER_DISCOUNT', minSubtotal: '0', discountAmount: '1' }))).toBeNull();
    expect(validateRuleForm(form({ kind: 'ORDER_DISCOUNT', minSubtotal: '5', orderMode: 'PERCENT', percentOff: '5' }))).toBeNull();
    expect(
      validateRuleForm(form({ kind: 'BUNDLE_GIFT', buyQty: '2', getQty: '1', giftProductId: 'g', productId: 't' })),
    ).toBeNull();
  });
});

describe('ruleFormFrom', () => {
  const rule = (over: Partial<PromoRule> = {}): PromoRule => ({
    id: 'r',
    name: 'R',
    kind: 'SPECIAL_PRICE',
    depotId: null,
    productId: null,
    categoryId: null,
    specialPrice: null,
    buyQty: null,
    getQty: null,
    shippingFeeOverride: null,
    percentOff: null,
    minSubtotal: null,
    discountAmount: null,
    giftProductId: null,
    firstOrderOnly: false,
    validFrom: null,
    validUntil: null,
    daysOfWeek: [],
    startTime: null,
    endTime: null,
    minQty: 1,
    maxQty: null,
    channels: [],
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('reopens a percent order-discount in PERCENT mode and an amount one in AMOUNT mode', () => {
    expect(ruleFormFrom(rule({ kind: 'ORDER_DISCOUNT', minSubtotal: 1, percentOff: 5 })).orderMode).toBe('PERCENT');
    expect(ruleFormFrom(rule({ kind: 'ORDER_DISCOUNT', minSubtotal: 1, discountAmount: 5000 })).orderMode).toBe('AMOUNT');
  });

  it('round-trips a gift rule through the form and back to the same payload fields', () => {
    const r = rule({ kind: 'BUNDLE_GIFT', buyQty: 2, getQty: 1, giftProductId: 'g', productId: 't', firstOrderOnly: true });
    const p = ruleFormToPayload(ruleFormFrom(r), null);
    expect(p).toMatchObject({ kind: 'BUNDLE_GIFT', buyQty: 2, getQty: 1, giftProductId: 'g', productId: 't', firstOrderOnly: true });
  });
});

/**
 * The editor builds these keys from a template (`${ns}.promoRules.fields.${…}`), which the
 * locale-keys test deliberately does not collect: a missing one would render the raw key.
 */
const lookup = (dict: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), dict);

describe('promo-rule editor copy exists in both languages and both consoles', () => {
  const FIELD_KEYS = [
    'kind', 'kindSpecialPrice', 'kindPercentOff', 'kindBogo', 'kindBundleGift', 'kindOrderDiscount', 'kindShipping',
    'specialPrice', 'buyQty', 'giftQty', 'percentOff', 'percentOffHint', 'minSubtotal', 'minSubtotalHint',
    'discountAmount', 'orderMode', 'orderModeAmount', 'orderModePercent', 'giftProductId', 'giftProductHint',
    'pickGiftProduct', 'firstOrderOnly', 'firstOrderOnlyHint', 'shippingFeeOverride',
  ].map((k) => `fields.${k}`);
  const ERROR_KEYS = ['needName', 'needPercent', 'needOrderDiscount', 'needGift', 'giftSameProduct'];

  for (const ns of ['hq', 'dashboard']) {
    for (const [locale, dict] of Object.entries({ id, en })) {
      it(`${locale}: ${ns}.promoRules has every key`, () => {
        for (const key of [...FIELD_KEYS, ...ERROR_KEYS]) {
          const value = lookup(dict, `${ns}.promoRules.${key}`);
          expect(typeof value, `${locale} ${ns}.promoRules.${key}`).toBe('string');
          expect(value).not.toBe('');
        }
      });
    }
  }
});
