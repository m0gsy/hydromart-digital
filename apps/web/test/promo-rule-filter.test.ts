import { describe, expect, it } from 'vitest';

import { EMPTY_RULE_FILTER, duplicateRule, filterRules, isFiltering } from '@/lib/promo-rule-filter';
import type { PromoRule } from '@/lib/types';

const rule = (over: Partial<PromoRule>): PromoRule => ({
  id: 'r',
  name: 'Rule',
  kind: 'SPECIAL_PRICE',
  depotId: null,
  productId: null,
  categoryId: null,
  specialPrice: 5000,
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

const RULES = [
  rule({ id: 'a', name: 'Jumat Berkah', kind: 'SPECIAL_PRICE', active: true }),
  rule({ id: 'b', name: 'Senin Optimis', kind: 'PERCENTAGE_OFF', active: false }),
  rule({ id: 'c', name: 'Beli 1 Gratis 1', kind: 'BUY_X_GET_Y', active: true }),
];

describe('filterRules', () => {
  it('the empty filter keeps everything and is not "filtering"', () => {
    expect(filterRules(RULES, EMPTY_RULE_FILTER)).toHaveLength(3);
    expect(isFiltering(EMPTY_RULE_FILTER)).toBe(false);
  });

  it('matches the name case-insensitively, ignoring surrounding spaces', () => {
    expect(filterRules(RULES, { ...EMPTY_RULE_FILTER, text: '  jumat ' }).map((r) => r.id)).toEqual(['a']);
    expect(filterRules(RULES, { ...EMPTY_RULE_FILTER, text: 'GRATIS' }).map((r) => r.id)).toEqual(['c']);
  });

  it('filters by kind and by status, alone or together', () => {
    expect(filterRules(RULES, { ...EMPTY_RULE_FILTER, kind: 'PERCENTAGE_OFF' }).map((r) => r.id)).toEqual(['b']);
    expect(filterRules(RULES, { ...EMPTY_RULE_FILTER, status: 'active' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterRules(RULES, { ...EMPTY_RULE_FILTER, status: 'inactive' }).map((r) => r.id)).toEqual(['b']);
    expect(filterRules(RULES, { text: 'senin', kind: 'PERCENTAGE_OFF', status: 'inactive' }).map((r) => r.id)).toEqual(['b']);
    expect(filterRules(RULES, { text: 'senin', kind: 'PERCENTAGE_OFF', status: 'active' })).toEqual([]);
  });

  it('any narrowing counts as filtering', () => {
    expect(isFiltering({ ...EMPTY_RULE_FILTER, text: 'x' })).toBe(true);
    expect(isFiltering({ ...EMPTY_RULE_FILTER, kind: 'BUNDLE_GIFT' })).toBe(true);
    expect(isFiltering({ ...EMPTY_RULE_FILTER, status: 'active' })).toBe(true);
  });
});

describe('duplicateRule', () => {
  it('keeps the settings, marks the name as a copy and switches the copy on', () => {
    const copy = duplicateRule(rule({ name: 'Senin Optimis', active: false, specialPrice: 7000 }), '(salinan)');
    expect(copy).toMatchObject({ name: 'Senin Optimis (salinan)', active: true, specialPrice: 7000 });
  });
});
