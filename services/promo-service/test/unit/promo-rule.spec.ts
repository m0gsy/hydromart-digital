import {
  CartLine,
  EvaluationContext,
  PromoRuleCandidate,
  evaluateGifts,
  evaluateLine,
  evaluateOrderDiscount,
  evaluateShipping,
  ruleMatchesLine,
} from '../../src/domain/promo-rule';

const BASE: Omit<
  PromoRuleCandidate,
  'id' | 'kind' | 'specialPrice' | 'buyQty' | 'getQty' | 'shippingFeeOverride'
> = {
  name: 'test',
  depotId: null,
  productId: null,
  categoryId: null,
  validFrom: null,
  validUntil: null,
  daysOfWeek: [],
  startTime: null,
  endTime: null,
  minQty: 1,
  maxQty: null,
  channels: [],
  percentOff: null,
  minSubtotal: null,
  discountAmount: null,
  giftProductId: null,
  firstOrderOnly: false,
};

const specialPrice = (overrides: Partial<PromoRuleCandidate> = {}): PromoRuleCandidate => ({
  ...BASE,
  id: 'rule-special',
  kind: 'SPECIAL_PRICE',
  specialPrice: 7000,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  ...overrides,
});

const bogo = (overrides: Partial<PromoRuleCandidate> = {}): PromoRuleCandidate => ({
  ...BASE,
  id: 'rule-bogo',
  kind: 'BUY_X_GET_Y',
  specialPrice: null,
  buyQty: 1,
  getQty: 1,
  shippingFeeOverride: null,
  ...overrides,
});

const shipping = (overrides: Partial<PromoRuleCandidate> = {}): PromoRuleCandidate => ({
  ...BASE,
  id: 'rule-ship',
  kind: 'SHIPPING_DISCOUNT',
  specialPrice: null,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: 1000,
  ...overrides,
});

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: 'prod-1',
  categoryId: 'cat-1',
  quantity: 1,
  unitPrice: 8000,
  ...overrides,
});

// Friday, 10:00 WIB.
const FRIDAY_10AM = new Date('2026-10-02T03:00:00.000Z');
const ctx = (overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  channel: 'APP',
  occurredAt: FRIDAY_10AM,
  timeZone: 'Asia/Jakarta',
  depotId: null,
  ...overrides,
});

describe('ruleMatchesLine', () => {
  it('matches a rule with no scoping at all', () => {
    expect(ruleMatchesLine(specialPrice(), line(), ctx())).toBe(true);
  });

  it('rejects a rule scoped to a different product', () => {
    expect(
      ruleMatchesLine(specialPrice({ productId: 'other-product' }), line(), ctx()),
    ).toBe(false);
  });

  it('matches a rule scoped to the line\'s category when productId is null', () => {
    expect(
      ruleMatchesLine(specialPrice({ categoryId: 'cat-1' }), line(), ctx()),
    ).toBe(true);
  });

  it('rejects a rule scoped to a different category when productId is null', () => {
    expect(
      ruleMatchesLine(specialPrice({ categoryId: 'other-cat' }), line(), ctx()),
    ).toBe(false);
  });

  it('matches a depot-scoped rule when the context\'s depot matches', () => {
    expect(
      ruleMatchesLine(specialPrice({ depotId: 'depot-a' }), line(), ctx({ depotId: 'depot-a' })),
    ).toBe(true);
  });

  it('rejects a depot-scoped rule when the context is a different depot', () => {
    expect(
      ruleMatchesLine(specialPrice({ depotId: 'depot-a' }), line(), ctx({ depotId: 'depot-b' })),
    ).toBe(false);
  });

  it('rejects a rule outside its validFrom/validUntil window', () => {
    const future = new Date('2099-01-01T00:00:00.000Z');
    expect(
      ruleMatchesLine(specialPrice({ validFrom: future }), line(), ctx()),
    ).toBe(false);
  });

  it('rejects a rule already past its validUntil', () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    expect(
      ruleMatchesLine(specialPrice({ validUntil: past }), line(), ctx()),
    ).toBe(false);
  });

  it('matches a rule whose validUntil is still ahead', () => {
    const future = new Date('2099-01-01T00:00:00.000Z');
    expect(
      ruleMatchesLine(specialPrice({ validUntil: future }), line(), ctx()),
    ).toBe(true);
  });

  it('matches a day-of-week rule on the right day (Friday = 5)', () => {
    expect(
      ruleMatchesLine(specialPrice({ daysOfWeek: [5] }), line(), ctx()),
    ).toBe(true);
  });

  it('rejects a day-of-week rule on the wrong day', () => {
    expect(
      ruleMatchesLine(specialPrice({ daysOfWeek: [1] }), line(), ctx()),
    ).toBe(false);
  });

  it('matches a time-of-day window that contains the hour', () => {
    expect(
      ruleMatchesLine(
        specialPrice({ startTime: '09:00', endTime: '12:00' }),
        line(),
        ctx(),
      ),
    ).toBe(true);
  });

  it('rejects a time-of-day window that excludes the hour', () => {
    expect(
      ruleMatchesLine(
        specialPrice({ startTime: '13:00', endTime: '18:00' }),
        line(),
        ctx(),
      ),
    ).toBe(false);
  });

  it('rejects an endTime-only window the hour has already passed', () => {
    // Friday 10:00 WIB vs a window that closed at 09:00 — exercises endTime's branch
    // independently of startTime (both are always null/set together in the tests above).
    expect(
      ruleMatchesLine(specialPrice({ endTime: '09:00' }), line(), ctx()),
    ).toBe(false);
  });

  it('rejects a COUNTER-only rule on an APP order', () => {
    expect(
      ruleMatchesLine(specialPrice({ channels: ['COUNTER'] }), line(), ctx({ channel: 'APP' })),
    ).toBe(false);
  });

  it('matches a COUNTER-only rule on a COUNTER order', () => {
    expect(
      ruleMatchesLine(
        specialPrice({ channels: ['COUNTER'] }),
        line(),
        ctx({ channel: 'COUNTER' }),
      ),
    ).toBe(true);
  });

  it('rejects a rule whose minQty the line does not reach', () => {
    expect(
      ruleMatchesLine(specialPrice({ minQty: 5 }), line({ quantity: 2 }), ctx()),
    ).toBe(false);
  });

  it('rejects a rule whose maxQty the line exceeds', () => {
    expect(
      ruleMatchesLine(specialPrice({ maxQty: 2 }), line({ quantity: 3 }), ctx()),
    ).toBe(false);
  });
});

describe('evaluateLine', () => {
  it('applies no promo when nothing matches', () => {
    const result = evaluateLine([], line(), ctx());
    expect(result).toEqual({
      productId: 'prod-1',
      appliedRuleIds: [],
      unitPriceAfter: 8000,
      freeQty: 0,
      lineTotal: 8000,
    });
  });

  it('applies the single matching SPECIAL_PRICE', () => {
    const result = evaluateLine([specialPrice({ specialPrice: 7000 })], line(), ctx());
    expect(result.unitPriceAfter).toBe(7000);
    expect(result.appliedRuleIds).toEqual(['rule-special']);
    expect(result.lineTotal).toBe(7000);
  });

  it('picks the lowest SPECIAL_PRICE among several matching candidates', () => {
    const cheaper = specialPrice({ id: 'cheaper', specialPrice: 6000 });
    const pricier = specialPrice({ id: 'pricier', specialPrice: 7000 });
    const result = evaluateLine([pricier, cheaper], line(), ctx());
    expect(result.unitPriceAfter).toBe(6000);
    expect(result.appliedRuleIds).toEqual(['cheaper']);
  });

  it('keeps the running-cheapest SPECIAL_PRICE when the next candidate is pricier (reduce order reversed)', () => {
    const cheaper = specialPrice({ id: 'cheaper', specialPrice: 6000 });
    const pricier = specialPrice({ id: 'pricier', specialPrice: 7000 });
    const result = evaluateLine([cheaper, pricier], line(), ctx());
    expect(result.unitPriceAfter).toBe(6000);
    expect(result.appliedRuleIds).toEqual(['cheaper']);
  });

  it('grants no free units when a BUY_X_GET_Y candidate is missing getQty (defensive: validate() should prevent this at creation)', () => {
    const result = evaluateLine([bogo({ getQty: null })], line({ quantity: 3 }), ctx());
    expect(result.freeQty).toBe(0);
    expect(result.appliedRuleIds).toEqual([]);
  });

  it('BUY_X_GET_Y doubles quantity for 1-for-1, buyer pays original qty', () => {
    const result = evaluateLine([bogo({ buyQty: 1, getQty: 1 })], line({ quantity: 3 }), ctx());
    expect(result.freeQty).toBe(3);
    expect(result.appliedRuleIds).toEqual(['rule-bogo']);
    // Paid units unaffected (no SPECIAL_PRICE here): 3 * 8000.
    expect(result.lineTotal).toBe(24000);
  });

  it('BUY_X_GET_Y with buyQty=2 grants 1 free per 2 bought, floor division', () => {
    const result = evaluateLine(
      [bogo({ buyQty: 2, getQty: 1 })],
      line({ quantity: 5 }),
      ctx(),
    );
    // floor(5/2)*1 = 2
    expect(result.freeQty).toBe(2);
  });

  it('picks the BUY_X_GET_Y candidate with the larger free-unit value', () => {
    const small = bogo({ id: 'small', buyQty: 2, getQty: 1 });
    const big = bogo({ id: 'big', buyQty: 1, getQty: 1 });
    const result = evaluateLine([small, big], line({ quantity: 2 }), ctx());
    // small: floor(2/2)*1=1 free. big: floor(2/1)*1=2 free. big wins.
    expect(result.appliedRuleIds).toEqual(['big']);
    expect(result.freeQty).toBe(2);
  });

  it('keeps the running-best BUY_X_GET_Y when the next candidate frees fewer units (reduce order reversed)', () => {
    const small = bogo({ id: 'small', buyQty: 2, getQty: 1 });
    const big = bogo({ id: 'big', buyQty: 1, getQty: 1 });
    const result = evaluateLine([big, small], line({ quantity: 2 }), ctx());
    expect(result.appliedRuleIds).toEqual(['big']);
    expect(result.freeQty).toBe(2);
  });

  it('stacks SPECIAL_PRICE and BUY_X_GET_Y on the same line', () => {
    const result = evaluateLine(
      [specialPrice({ specialPrice: 7000 }), bogo({ buyQty: 1, getQty: 1 })],
      line({ quantity: 2 }),
      ctx(),
    );
    expect(result.unitPriceAfter).toBe(7000);
    expect(result.freeQty).toBe(2);
    expect(result.appliedRuleIds).toEqual(
      expect.arrayContaining(['rule-special', 'rule-bogo']),
    );
    // Paid: 2 * 7000 = 14000. Free units cost nothing.
    expect(result.lineTotal).toBe(14000);
  });

  it('never applies a SPECIAL_PRICE that is higher than the line\'s current unitPrice', () => {
    const result = evaluateLine([specialPrice({ specialPrice: 9000 })], line({ unitPrice: 8000 }), ctx());
    expect(result.unitPriceAfter).toBe(8000);
    expect(result.appliedRuleIds).toEqual([]);
  });

  it('ignores SHIPPING_DISCOUNT candidates when computing a product line', () => {
    const result = evaluateLine([shipping()], line(), ctx());
    expect(result.appliedRuleIds).toEqual([]);
    expect(result.unitPriceAfter).toBe(8000);
  });
});

describe('evaluateShipping', () => {
  it('returns null when nothing matches', () => {
    expect(evaluateShipping([], ctx())).toEqual({
      appliedRuleId: null,
      shippingFeeOverride: null,
    });
  });

  it('picks the lowest shippingFeeOverride among matching candidates', () => {
    const cheaper = shipping({ id: 'cheaper', shippingFeeOverride: 1000 });
    const pricier = shipping({ id: 'pricier', shippingFeeOverride: 2000 });
    const result = evaluateShipping([pricier, cheaper], ctx());
    expect(result).toEqual({ appliedRuleId: 'cheaper', shippingFeeOverride: 1000 });
  });

  it('keeps the running-cheapest shipping candidate when the next one is pricier (reduce order reversed)', () => {
    const cheaper = shipping({ id: 'cheaper', shippingFeeOverride: 1000 });
    const pricier = shipping({ id: 'pricier', shippingFeeOverride: 2000 });
    const result = evaluateShipping([cheaper, pricier], ctx());
    expect(result).toEqual({ appliedRuleId: 'cheaper', shippingFeeOverride: 1000 });
  });

  it('ignores SPECIAL_PRICE/BUY_X_GET_Y candidates', () => {
    const result = evaluateShipping([specialPrice(), bogo()], ctx());
    expect(result.shippingFeeOverride).toBeNull();
  });
});

const percentOff = (overrides: Partial<PromoRuleCandidate> = {}): PromoRuleCandidate => ({
  ...BASE,
  id: 'rule-pct',
  kind: 'PERCENTAGE_OFF',
  specialPrice: null,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  percentOff: 25,
  ...overrides,
});

const orderDiscount = (overrides: Partial<PromoRuleCandidate> = {}): PromoRuleCandidate => ({
  ...BASE,
  id: 'rule-order',
  kind: 'ORDER_DISCOUNT',
  specialPrice: null,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  minSubtotal: 100000,
  discountAmount: 10000,
  ...overrides,
});

const gift = (overrides: Partial<PromoRuleCandidate> = {}): PromoRuleCandidate => ({
  ...BASE,
  id: 'rule-gift',
  kind: 'BUNDLE_GIFT',
  specialPrice: null,
  buyQty: 2,
  getQty: 1,
  shippingFeeOverride: null,
  giftProductId: 'prod-gift',
  ...overrides,
});

describe('PERCENTAGE_OFF', () => {
  it('takes the percent off the unit price', () => {
    const r = evaluateLine([percentOff()], line({ unitPrice: 8000, quantity: 2 }), ctx());
    expect(r).toMatchObject({ unitPriceAfter: 6000, appliedRuleIds: ['rule-pct'], lineTotal: 12000 });
  });

  it('competes with SPECIAL_PRICE: the lower resulting price wins', () => {
    const cheaperPct = evaluateLine([specialPrice({ specialPrice: 7000 }), percentOff()], line(), ctx());
    expect(cheaperPct.appliedRuleIds).toEqual(['rule-pct']); // 6000 < 7000
    const cheaperSpecial = evaluateLine([specialPrice({ specialPrice: 5000 }), percentOff()], line(), ctx());
    expect(cheaperSpecial.appliedRuleIds).toEqual(['rule-special']); // 5000 < 6000
  });

  it('never prices an item at Rp0 (order-service reads 0 as a free row), and ignores a rule that cannot lower it', () => {
    const r = evaluateLine([percentOff({ percentOff: 99 })], line({ unitPrice: 20 }), ctx());
    expect(r.unitPriceAfter).toBe(1);
    const tiny = evaluateLine([percentOff({ percentOff: 10 })], line({ unitPrice: 1 }), ctx());
    expect(tiny).toMatchObject({ unitPriceAfter: 1, appliedRuleIds: [] });
  });

  it('stacks with BUY_X_GET_Y the way SPECIAL_PRICE does (free units valued at the new price)', () => {
    const r = evaluateLine([percentOff(), bogo()], line({ quantity: 2 }), ctx());
    expect(r).toMatchObject({ unitPriceAfter: 6000, freeQty: 2, appliedRuleIds: ['rule-pct', 'rule-bogo'] });
  });
});

describe('tiered price by quantity (no new kind: several SPECIAL_PRICE bands)', () => {
  const bands = [
    specialPrice({ id: 'band-1', specialPrice: 7500, minQty: 5, maxQty: 9 }),
    specialPrice({ id: 'band-2', specialPrice: 7000, minQty: 10 }),
  ];
  it.each([
    [4, 8000, []],
    [5, 7500, ['band-1']],
    [9, 7500, ['band-1']],
    [10, 7000, ['band-2']],
    [25, 7000, ['band-2']],
  ])('quantity %i is priced %i', (quantity, price, ids) => {
    const r = evaluateLine(bands, line({ quantity }), ctx());
    expect(r.unitPriceAfter).toBe(price);
    expect(r.appliedRuleIds).toEqual(ids);
  });
});

describe('firstOrderOnly', () => {
  it('matches only when the caller says the customer is new', () => {
    const rule = specialPrice({ firstOrderOnly: true });
    expect(ruleMatchesLine(rule, line(), ctx())).toBe(false);
    expect(ruleMatchesLine(rule, line(), ctx({ firstOrder: false }))).toBe(false);
    expect(ruleMatchesLine(rule, line(), ctx({ firstOrder: true }))).toBe(true);
  });

  it('does not restrict a rule that is not first-order-only', () => {
    expect(ruleMatchesLine(specialPrice(), line(), ctx({ firstOrder: true }))).toBe(true);
    expect(ruleMatchesLine(specialPrice(), line(), ctx())).toBe(true);
  });

  it('works on an order-level rule too', () => {
    const rule = orderDiscount({ firstOrderOnly: true });
    expect(evaluateOrderDiscount([rule], ctx(), 150000).amount).toBe(0);
    expect(evaluateOrderDiscount([rule], ctx({ firstOrder: true }), 150000).amount).toBe(10000);
  });
});

describe('skipPromo lines', () => {
  it('come back untouched even when a rule would match', () => {
    const r = evaluateLine([specialPrice(), bogo()], line({ quantity: 4, skipPromo: true }), ctx());
    expect(r).toMatchObject({ unitPriceAfter: 8000, freeQty: 0, appliedRuleIds: [], lineTotal: 32000 });
  });
  it('trigger no gift', () => {
    expect(evaluateGifts([gift()], [line({ quantity: 4, skipPromo: true })], ctx())).toEqual([]);
  });
});

describe('ORDER_DISCOUNT', () => {
  it('applies a fixed amount once the subtotal reaches the minimum', () => {
    expect(evaluateOrderDiscount([orderDiscount()], ctx(), 99999)).toEqual({ appliedRuleId: null, amount: 0 });
    expect(evaluateOrderDiscount([orderDiscount()], ctx(), 100000)).toEqual({
      appliedRuleId: 'rule-order',
      amount: 10000,
    });
  });

  it('applies a percent of the subtotal, rounded', () => {
    const r = orderDiscount({ discountAmount: null, percentOff: 5 });
    expect(evaluateOrderDiscount([r], ctx(), 100010).amount).toBe(5001); // 5000.5 -> 5001
  });

  it('is never more than the subtotal', () => {
    const r = orderDiscount({ minSubtotal: 0, discountAmount: 50000 });
    expect(evaluateOrderDiscount([r], ctx(), 20000).amount).toBe(20000);
  });

  it('the biggest discount wins', () => {
    const small = orderDiscount({ id: 'small', discountAmount: 5000 });
    const pct = orderDiscount({ id: 'pct', discountAmount: null, percentOff: 10 });
    expect(evaluateOrderDiscount([small, pct], ctx(), 200000)).toEqual({ appliedRuleId: 'pct', amount: 20000 });
  });

  it('respects schedule, channel and depot like every other rule', () => {
    expect(evaluateOrderDiscount([orderDiscount({ channels: ['COUNTER'] })], ctx(), 150000).amount).toBe(0);
    expect(evaluateOrderDiscount([orderDiscount({ daysOfWeek: [1] })], ctx(), 150000).amount).toBe(0); // Friday
    expect(evaluateOrderDiscount([orderDiscount({ depotId: 'd-2' })], ctx({ depotId: 'd-1' }), 150000).amount).toBe(0);
  });

  it('ignores rules of other kinds and rules with no usable discount', () => {
    expect(evaluateOrderDiscount([specialPrice()], ctx(), 150000).amount).toBe(0);
    expect(
      evaluateOrderDiscount([orderDiscount({ discountAmount: null, percentOff: null })], ctx(), 150000).amount,
    ).toBe(0);
    expect(evaluateOrderDiscount([orderDiscount({ minSubtotal: null })], ctx(), 150000).amount).toBe(0);
  });
});

describe('BUNDLE_GIFT', () => {
  it('hands over getQty of the OTHER product for every buyQty bought', () => {
    expect(evaluateGifts([gift()], [line({ quantity: 5 })], ctx())).toEqual([
      { promoRuleId: 'rule-gift', productId: 'prod-gift', quantity: 2, triggerProductId: 'prod-1' },
    ]);
  });

  it('gives nothing below buyQty, or when the line is out of the rule scope', () => {
    expect(evaluateGifts([gift()], [line({ quantity: 1 })], ctx())).toEqual([]);
    expect(evaluateGifts([gift({ productId: 'other' })], [line({ quantity: 5 })], ctx())).toEqual([]);
  });

  it('one winner per line: the bigger gift', () => {
    const big = gift({ id: 'big', buyQty: 1, getQty: 3 });
    const small = gift({ id: 'small', buyQty: 1, getQty: 1 });
    const out = evaluateGifts([small, big], [line({ quantity: 2 })], ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ promoRuleId: 'big', quantity: 6 });
  });

  it('each trigger line can win its own gift', () => {
    const out = evaluateGifts(
      [gift({ buyQty: 1, getQty: 1 })],
      [line({ productId: 'a' }), line({ productId: 'b', quantity: 2 })],
      ctx(),
    );
    expect(out.map((g) => [g.triggerProductId, g.quantity])).toEqual([['a', 1], ['b', 2]]);
  });

  it('ignores a rule with no gift product, and rules of other kinds', () => {
    expect(evaluateGifts([gift({ giftProductId: null })], [line({ quantity: 4 })], ctx())).toEqual([]);
    expect(evaluateGifts([bogo()], [line({ quantity: 4 })], ctx())).toEqual([]);
  });
});
