import {
  CartLine,
  EvaluationContext,
  PromoRuleCandidate,
  evaluateLine,
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
