import { randomUUID } from 'node:crypto';

import {
  buildCartService,
  FakeDepotPricing,
  FakeProductCatalog,
  FakePromoAutoApply,
  FakeResellerDiscount,
  InMemoryCartRepository,
  InMemoryOrderRepository,
} from '../support/fakes';

describe('CartService promo preview', () => {
  const customer = randomUUID();
  const depot = randomUUID();
  let cart: InMemoryCartRepository;
  let catalog: FakeProductCatalog;
  let promo: FakePromoAutoApply;
  let productId: string;

  let reseller: FakeResellerDiscount;

  const view = (depotId: string | null = depot) => {
    const service = buildCartService(cart, catalog, undefined, reseller, undefined, promo);
    return service.view(customer, depotId, 'Bearer t');
  };

  beforeEach(async () => {
    cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    promo = new FakePromoAutoApply();
    reseller = new FakeResellerDiscount();
    productId = catalog.seed({ id: randomUUID(), basePrice: 10000, categoryId: 'cat-air' }).id;
    await cart.upsert(customer, productId, 4);
  });

  it('shows no promo when nothing matched', async () => {
    const v = await view();
    expect(v.promo).toBeNull();
    expect(v.subtotal).toBe(40000);
  });

  it('shows the post-promo subtotal and savings, and leaves the line prices alone', async () => {
    promo.quoteResult = {
      lines: [{ productId, appliedRuleIds: ['r1'], unitPriceAfter: 8000, freeQty: 0, lineTotal: 32000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const v = await view();
    expect(v.subtotal).toBe(40000); // pre-promo, as before
    expect(v.items[0].unitPrice).toBe(10000);
    expect(v.promo).toEqual({
      subtotal: 32000,
      savings: 8000,
      lines: [{ productId, unitPriceAfter: 8000, freeQty: 0 }],
      shippingFeeOverride: null,
      orderDiscount: 0,
      gifts: [],
    });
  });

  it('reports a BOGO free quantity without charging for it', async () => {
    promo.quoteResult = {
      lines: [{ productId, appliedRuleIds: ['bogo'], unitPriceAfter: 10000, freeQty: 4, lineTotal: 40000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const v = await view();
    expect(v.promo).toMatchObject({ subtotal: 40000, savings: 0, lines: [{ productId, freeQty: 4 }] });
  });

  it('reports a shipping-only promo', async () => {
    promo.quoteResult = { lines: [], shippingAppliedRuleId: 'ship', shippingFeeOverride: 1000 };
    const v = await view();
    expect(v.promo).toMatchObject({ savings: 0, lines: [], shippingFeeOverride: 1000 });
  });

  it('sends the catalog category and does not ask promo-service without a depot', async () => {
    await view();
    expect(promo.quoteCalls[0]).toMatchObject({
      depotId: depot,
      channel: 'APP',
      lines: [{ productId, categoryId: 'cat-air', quantity: 4, unitPrice: 10000 }],
    });
    promo.quoteCalls.length = 0;
    const v = await view(null);
    expect(promo.quoteCalls).toHaveLength(0);
    expect(v.promo).toBeNull();
  });

  it('computes the agen percentage on the POST-promo basket, like checkout', async () => {
    reseller.result = { active: true, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: depot };
    promo.quoteResult = {
      lines: [{ productId, appliedRuleIds: ['r1'], unitPriceAfter: 8000, freeQty: 0, lineTotal: 32000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const v = await view();
    expect(v.reseller?.discount).toBe(3200); // 10% of 32000, not of 40000
  });

  it('shows an order discount, capped at the post-promo goods', async () => {
    promo.quoteResult = {
      lines: [],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
      orderDiscountRuleId: 'r-order',
      orderDiscountAmount: 5000,
    };
    expect((await view()).promo).toMatchObject({ orderDiscount: 5000, savings: 0 });
    promo.quoteResult = { ...promo.quoteResult, orderDiscountAmount: 90000 };
    expect((await view()).promo?.orderDiscount).toBe(40000);
  });

  it('names the gifts the basket earns, and leaves out one it cannot read', async () => {
    const gift = catalog.seed({ id: randomUUID(), basePrice: 5000, name: 'Botol 600ml' });
    promo.quoteResult = {
      lines: [],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
      gifts: [
        { promoRuleId: 'r-gift', productId: gift.id, quantity: 1, triggerProductId: productId },
        { promoRuleId: 'r-gift', productId: gift.id, quantity: 2, triggerProductId: productId },
        { promoRuleId: 'r-gift', productId: randomUUID(), quantity: 1, triggerProductId: productId },
      ],
    };
    expect((await view()).promo?.gifts).toEqual([{ productId: gift.id, productName: 'Botol 600ml', quantity: 3 }]);
  });

  it('tells promo-service the customer is new until they have an order, and the cart still works if the lookup fails', async () => {
    await view();
    expect(promo.quoteCalls[0].firstOrder).toBe(true);

    const orders = new InMemoryOrderRepository();
    jest.spyOn(orders, 'customerLifetime').mockRejectedValue(new Error('db down'));
    const svc = buildCartService(cart, catalog, undefined, reseller, undefined, promo, orders);
    await svc.view(customer, depot, 'Bearer t');
    expect(promo.quoteCalls[1].firstOrder).toBe(false);
  });

  it('flags wholesale lines skipPromo so the order subtotal still counts them', async () => {
    const pricing = new FakeDepotPricing();
    pricing.setTier(depot, productId, 4, 9000);
    const svc = buildCartService(cart, catalog, pricing, reseller, undefined, promo);
    await svc.view(customer, depot, 'Bearer t');
    expect(promo.quoteCalls[0].lines[0]).toMatchObject({ productId, skipPromo: true });
  });

  it('puts the catalog category on each line, for category-scoped vouchers', async () => {
    const v = await view();
    expect(v.items[0].categoryId).toBe('cat-air');
  });
});
