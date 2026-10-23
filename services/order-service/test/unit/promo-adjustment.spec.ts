import { CreateOrderItemData } from '../../src/application/ports/order.repository';
import { AutoApplyQuoteResult } from '../../src/application/ports/promo-auto-apply.port';
import { applyPromoQuote, stockLinesFor, summarizeAppliedPromos } from '../../src/domain/promo-adjustment';

const item = (overrides: Partial<CreateOrderItemData> = {}): CreateOrderItemData => ({
  productId: 'p1',
  productName: 'Galon 19L',
  sku: 'GAL-19',
  unit: 'galon',
  volumeMl: 19000,
  isGallon: true,
  unitPrice: 8000,
  quantity: 2,
  lineTotal: 16000,
  ...overrides,
});

const emptyQuote: AutoApplyQuoteResult = {
  lines: [],
  shippingAppliedRuleId: null,
  shippingFeeOverride: null,
};

describe('applyPromoQuote', () => {
  it('leaves items and subtotal unchanged when nothing matched', () => {
    const result = applyPromoQuote([item()], emptyQuote);
    expect(result.items).toEqual([item()]);
    expect(result.subtotal).toBe(16000);
  });

  it('builds appliedLines with a no-op entry when nothing matched', () => {
    const result = applyPromoQuote([item()], emptyQuote);
    expect(result.appliedLines).toEqual([
      { productId: 'p1', unitPrice: 8000, quantity: 2, appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0 },
    ]);
  });

  it('applies a SPECIAL_PRICE adjustment: same row, new unitPrice/lineTotal', () => {
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 7000, freeQty: 0, lineTotal: 14000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote([item()], quote);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ unitPrice: 7000, quantity: 2, lineTotal: 14000 });
    expect(result.subtotal).toBe(14000);
    // appliedLines carries the ORIGINAL unitPrice/quantity alongside the quote's result —
    // promo-service's apply() needs both to compute the audit discountValue itself.
    expect(result.appliedLines).toEqual([
      { productId: 'p1', unitPrice: 8000, quantity: 2, appliedRuleIds: ['r1'], unitPriceAfter: 7000, freeQty: 0 },
    ]);
  });

  it('adds a separate zero-price row for BUY_X_GET_Y free units', () => {
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 8000, freeQty: 2, lineTotal: 16000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote([item()], quote);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ productId: 'p1', quantity: 2, unitPrice: 8000, lineTotal: 16000 });
    expect(result.items[1]).toMatchObject({ productId: 'p1', quantity: 2, unitPrice: 0, lineTotal: 0 });
    // Free row keeps the same catalog identity (name/sku/unit/volumeMl/isGallon) so stock,
    // galon counting and the receipt all still recognise what product it is.
    expect(result.items[1]).toMatchObject({
      productName: 'Galon 19L',
      sku: 'GAL-19',
      unit: 'galon',
      volumeMl: 19000,
      isGallon: true,
    });
    expect(result.subtotal).toBe(16000);
    // appliedLines stays ONE entry per original line (not split like `items` is) — the
    // free-row split is an order-presentation detail, not something promo-service's audit
    // needs duplicated.
    expect(result.appliedLines).toEqual([
      { productId: 'p1', unitPrice: 8000, quantity: 2, appliedRuleIds: ['r1'], unitPriceAfter: 8000, freeQty: 2 },
    ]);
  });

  it('leaves a line whose quote result matched no rule untouched', () => {
    // Fix 5: matched to `items` BY POSITION. promo-service always returns one LineResult
    // per request line (evaluateLine), so "nothing matched" is a neutral result at the SAME
    // index — never a missing or differently-productId'd entry, which could not happen from
    // a real quote() response and is no longer how this function decides a no-op.
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'p1', appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0, lineTotal: 16000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote([item()], quote);
    expect(result.items).toEqual([item()]);
    expect(result.subtotal).toBe(16000);
  });

  it('sums subtotal correctly across several lines, some adjusted some not', () => {
    const items = [item(), item({ productId: 'p2', unitPrice: 5000, quantity: 1, lineTotal: 5000 })];
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 6000, freeQty: 0, lineTotal: 12000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote(items, quote);
    expect(result.subtotal).toBe(17000); // 12000 (p1 after promo) + 5000 (p2 untouched)
  });
});

describe('applyPromoQuote skips wholesale-priced products', () => {
  it('leaves a skipped product at its band price, with no rule and no free row, while others still match', () => {
    const items = [item({ quantity: 4, lineTotal: 32000 }), item({ productId: 'p2', unitPrice: 5000, quantity: 2, lineTotal: 10000 })];
    const quote: AutoApplyQuoteResult = {
      lines: [
        { productId: 'p1', appliedRuleIds: ['bogo-1'], unitPriceAfter: 6000, freeQty: 1, lineTotal: 24000 },
        { productId: 'p2', appliedRuleIds: ['special-1'], unitPriceAfter: 4000, freeQty: 0, lineTotal: 8000 },
      ],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote(items, quote, new Set(['p1']));

    expect(result.items).toHaveLength(2); // no free row for the wholesale line
    expect(result.items[0]).toMatchObject({ productId: 'p1', unitPrice: 8000, quantity: 4 });
    expect(result.items[1]).toMatchObject({ productId: 'p2', unitPrice: 4000 });
    expect(result.subtotal).toBe(32000 + 8000);
    expect(result.appliedLines[0]).toMatchObject({ appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0 });
  });
});

describe('stockLinesFor', () => {
  it('returns one line per distinct productId when there is no split', () => {
    expect(stockLinesFor([item()])).toEqual([{ productId: 'p1', quantity: 2 }]);
  });

  it('sums quantity across a paid row and a free row for the same product', () => {
    const items = [item({ quantity: 2 }), item({ unitPrice: 0, quantity: 2, lineTotal: 0 })];
    expect(stockLinesFor(items)).toEqual([{ productId: 'p1', quantity: 4 }]);
  });

  it('keeps separate products separate', () => {
    const items = [item(), item({ productId: 'p2', quantity: 1 })];
    expect(stockLinesFor(items)).toEqual(
      expect.arrayContaining([
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 1 },
      ]),
    );
  });
});

describe('applyPromoQuote matches quote.lines to items BY POSITION', () => {
  it('gives two separate lines for the same productId their OWN quote result, not a shared one', () => {
    // Same product, two separate cart lines — nothing stops this at the DTO level. The
    // first line qualifies for a minQty-gated BOGO (quantity 4), the second does not
    // (quantity 1). A productId-keyed Map would collapse both onto whichever quote entry
    // it saw last; matching by index must keep them apart.
    const items = [
      item({ quantity: 4, lineTotal: 32000 }),
      item({ quantity: 1, lineTotal: 8000 }),
    ];
    const quote: AutoApplyQuoteResult = {
      lines: [
        // index 0 (quantity 4): qualifies, 1 free unit granted
        { productId: 'p1', appliedRuleIds: ['bogo-1'], unitPriceAfter: 8000, freeQty: 1, lineTotal: 32000 },
        // index 1 (quantity 1): does not qualify, untouched
        { productId: 'p1', appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0, lineTotal: 8000 },
      ],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote(items, quote);

    // Line 0: paid row unchanged + a separate free row for its own 1 free unit.
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ quantity: 4, unitPrice: 8000, lineTotal: 32000 });
    expect(result.items[1]).toMatchObject({ quantity: 1, unitPrice: 0, lineTotal: 0 });
    // Line 1 (the non-qualifying one): untouched, no free row of its own.
    expect(result.items[2]).toMatchObject({ quantity: 1, unitPrice: 8000, lineTotal: 8000 });

    expect(result.appliedLines).toEqual([
      { productId: 'p1', unitPrice: 8000, quantity: 4, appliedRuleIds: ['bogo-1'], unitPriceAfter: 8000, freeQty: 1 },
      { productId: 'p1', unitPrice: 8000, quantity: 1, appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0 },
    ]);
  });
});

describe('summarizeAppliedPromos', () => {
  const line = (o: Partial<Parameters<typeof summarizeAppliedPromos>[0]['appliedLines'][number]> = {}) => ({
    productId: 'p1',
    unitPrice: 8000,
    quantity: 3,
    appliedRuleIds: [] as string[],
    unitPriceAfter: 8000,
    freeQty: 0,
    ...o,
  });
  const none = {
    orderDiscount: { ruleId: null, amount: 0 },
    shipping: { ruleId: null, saved: 0 },
    gifts: [],
  };

  it('values a price cut as the unit drop times the quantity', () => {
    const out = summarizeAppliedPromos({
      ...none,
      appliedLines: [line({ appliedRuleIds: ['r1'], unitPriceAfter: 6000 })],
      ruleNames: { r1: 'Jumat Berkah' },
    });
    expect(out).toEqual([{ name: 'Jumat Berkah', effect: 'PRICE', amountIdr: 6000 }]);
  });

  it('values free units at their post-discount price, the way apply() records them', () => {
    const out = summarizeAppliedPromos({
      ...none,
      appliedLines: [line({ appliedRuleIds: ['b1'], freeQty: 3, unitPriceAfter: 8000 })],
      ruleNames: { b1: 'Beli 1 Gratis 1' },
    });
    expect(out).toEqual([{ name: 'Beli 1 Gratis 1', effect: 'FREE', amountIdr: 24000 }]);
  });

  it('keeps a price rule and a free-unit rule on the same line apart', () => {
    const out = summarizeAppliedPromos({
      ...none,
      appliedLines: [line({ appliedRuleIds: ['p1', 'b1'], unitPriceAfter: 6000, freeQty: 1 })],
      ruleNames: { p1: 'Harga Khusus', b1: 'Beli 3 Gratis 1' },
    });
    expect(out).toEqual([
      { name: 'Harga Khusus', effect: 'PRICE', amountIdr: 6000 },
      { name: 'Beli 3 Gratis 1', effect: 'FREE', amountIdr: 6000 },
    ]);
  });

  it('adds one rule across several lines into a single entry, biggest first', () => {
    const out = summarizeAppliedPromos({
      ...none,
      appliedLines: [
        line({ productId: 'a', appliedRuleIds: ['r1'], unitPriceAfter: 7000, quantity: 1 }),
        line({ productId: 'b', appliedRuleIds: ['r1'], unitPriceAfter: 7000, quantity: 2 }),
        line({ productId: 'c', appliedRuleIds: ['r2'], unitPriceAfter: 7500, quantity: 1 }),
      ],
      ruleNames: { r1: 'A', r2: 'B' },
    });
    expect(out).toEqual([
      { name: 'A', effect: 'PRICE', amountIdr: 3000 },
      { name: 'B', effect: 'PRICE', amountIdr: 500 },
    ]);
  });

  it('lists the order discount, the shipping saving and the gift', () => {
    const out = summarizeAppliedPromos({
      appliedLines: [],
      orderDiscount: { ruleId: 'o1', amount: 5000 },
      shipping: { ruleId: 's1', saved: 1500 },
      gifts: [{ promoRuleId: 'g1', value: 3000 }],
      ruleNames: { o1: 'Belanja Hemat', s1: 'Ongkir Murah', g1: 'Bonus Tutup' },
    });
    expect(out).toEqual([
      { name: 'Belanja Hemat', effect: 'ORDER', amountIdr: 5000 },
      { name: 'Bonus Tutup', effect: 'GIFT', amountIdr: 3000 },
      { name: 'Ongkir Murah', effect: 'SHIPPING', amountIdr: 1500 },
    ]);
  });

  it('skips a rule with nothing taken off, and a rule whose name was not sent', () => {
    const out = summarizeAppliedPromos({
      appliedLines: [line({ appliedRuleIds: ['unnamed'], unitPriceAfter: 6000 })],
      orderDiscount: { ruleId: 'o1', amount: 0 },
      shipping: { ruleId: 's1', saved: 0 },
      gifts: [],
      ruleNames: {},
    });
    expect(out).toEqual([]);
  });

  it('does not guess when a line claims more rules than it won', () => {
    // promo-service pushes exactly one id per win; a mismatch means the line is not what it
    // says, and a wrong name on the till is worse than none.
    const out = summarizeAppliedPromos({
      ...none,
      appliedLines: [line({ appliedRuleIds: ['r1', 'r2'], unitPriceAfter: 6000 })],
      ruleNames: { r1: 'A', r2: 'B' },
    });
    expect(out).toEqual([]);
  });
});
