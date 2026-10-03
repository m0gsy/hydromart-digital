import { CreateOrderItemData } from '../../src/application/ports/order.repository';
import { AutoApplyQuoteResult } from '../../src/application/ports/promo-auto-apply.port';
import { applyPromoQuote, stockLinesFor } from '../../src/domain/promo-adjustment';

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

  it('leaves a line with no matching quote result untouched', () => {
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'other-product', appliedRuleIds: ['r1'], unitPriceAfter: 1, freeQty: 0, lineTotal: 1 }],
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
