import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { ProductUnavailableError } from '../../src/domain/errors';
import {
  buildCartService,
  buildTestConfig,
  FakeDepotPricing,
  FakeProductCatalog,
  InMemoryCartRepository,
} from '../support/fakes';

describe('CartService', () => {
  let cart: InMemoryCartRepository;
  let catalog: FakeProductCatalog;
  let service: CartService;
  const customer = randomUUID();

  beforeEach(() => {
    cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    service = buildCartService(cart, catalog);
  });

  it('adds an item and prices the cart from the live catalog', async () => {
    const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    const view = await service.setItem(customer, p.id, 2, false);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].lineTotal).toBe(40000);
    expect(view.subtotal).toBe(40000);
  });

  it('accumulates quantity on repeated adds, replaces it on absolute set', async () => {
    const p = catalog.seed({ id: randomUUID() });
    await service.setItem(customer, p.id, 2, false);
    await service.setItem(customer, p.id, 3, false);
    let view = await service.view(customer);
    expect(view.items[0].quantity).toBe(5);

    view = await service.setItem(customer, p.id, 1, true);
    expect(view.items[0].quantity).toBe(1);
  });

  it('rejects adding an unknown or inactive product', async () => {
    await expect(service.setItem(customer, randomUUID(), 1, false)).rejects.toBeInstanceOf(
      ProductUnavailableError,
    );
    const inactive = catalog.seed({ id: randomUUID(), active: false });
    await expect(service.setItem(customer, inactive.id, 1, false)).rejects.toBeInstanceOf(
      ProductUnavailableError,
    );
  });

  it('hides a line whose product was delisted after it was added', async () => {
    const p = catalog.seed({ id: randomUUID() });
    await service.setItem(customer, p.id, 1, false);
    p.active = false;
    const view = await service.view(customer);
    expect(view.items).toHaveLength(0);
    expect(view.subtotal).toBe(0);
  });

  /*
   * PG-03 — the shelf and the till quoting different numbers.
   *
   * The catalogue grid and the product page printed `product.basePrice`; the cart and the
   * checkout price every line against the depot that will fulfil it. At a depot running a
   * +10% rule the shopper read Rp20.000 a galon on two screens, pressed a button that said
   * Rp40.000 for two, and then read Rp44.000 in the cart with nothing having changed.
   *
   * The fix cannot be arithmetic in the browser: a second implementation of the price is how
   * the two screens came to disagree in the first place. `shelfPrices` is the SAME
   * `priceLines` the cart bills with, asked one product at a time, so a shelf price that
   * differs from the bill would have to be a bug in the code that produced both.
   */
  describe('shelfPrices (PG-03)', () => {
    it("answers with the depot's price, from the same path the cart is billed by", async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const pricing = new FakeDepotPricing();
      const depotId = randomUUID();
      pricing.setRule(depotId, p.id, 'PERCENT', 10);
      const svc = buildCartService(cart, catalog, pricing);

      const shelf = await svc.shelfPrices(depotId, [p.id]);
      expect(shelf).toEqual({ basis: 'DEPOT', prices: [{ productId: p.id, unitPrice: 22000 }] });

      // ...and the cart agrees, because it is the same function.
      await svc.setItem(customer, p.id, 2, false);
      const view = await svc.view(customer, depotId);
      expect(view.items[0].unitPrice).toBe(22000);
    });

    it('falls back to catalog prices and SAYS so when no depot is known', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const shelf = await service.shelfPrices(null, [p.id]);
      expect(shelf).toEqual({ basis: 'CATALOG', prices: [{ productId: p.id, unitPrice: 20000 }] });
    });

    it('reports CATALOG when depot-service cannot be read, never a made-up number', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const pricing = new FakeDepotPricing();
      pricing.unavailable = true;
      const shelf = await buildCartService(cart, catalog, pricing).shelfPrices(randomUUID(), [p.id]);
      expect(shelf.basis).toBe('CATALOG');
      expect(shelf.prices).toEqual([{ productId: p.id, unitPrice: 20000 }]);
    });

    it('skips a product the catalogue does not have, rather than inventing one', async () => {
      const shelf = await service.shelfPrices(null, [randomUUID()]);
      expect(shelf.prices).toEqual([]);
    });

    it('asks nothing at all for an empty list', async () => {
      const pricing = new FakeDepotPricing();
      const shelf = await buildCartService(cart, catalog, pricing).shelfPrices(randomUUID(), ['']);
      expect(shelf).toEqual({ basis: 'CATALOG', prices: [] });
      expect(pricing.calls).toHaveLength(0);
    });

    // The per-depot kill switch is the same one the cart obeys: off means catalog prices,
    // and the shelf must say CATALOG rather than quietly showing base prices as the depot's.
    it('honours the per-depot pricing kill switch', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const pricing = new FakeDepotPricing();
      const depotId = randomUUID();
      pricing.setRule(depotId, p.id, 'PERCENT', 10);
      const svc = buildCartService(
        cart,
        catalog,
        pricing,
        undefined,
        buildTestConfig({ ORDER_CART_DEPOT_PRICING: '0' }),
      );

      const shelf = await svc.shelfPrices(depotId, [p.id]);
      expect(shelf).toEqual({ basis: 'CATALOG', prices: [{ productId: p.id, unitPrice: 20000 }] });
    });
  });

  it('removes an item and empties the cart', async () => {
    const p = catalog.seed({ id: randomUUID() });
    await service.setItem(customer, p.id, 1, false);
    await service.removeItem(customer, p.id);
    expect((await service.view(customer)).items).toHaveLength(0);
  });

  it('clears the whole cart at once (what checkout does on success)', async () => {
    await service.setItem(customer, catalog.seed({ id: randomUUID() }).id, 1, false);
    await service.setItem(customer, catalog.seed({ id: randomUUID() }).id, 2, false);
    await service.clear(customer);
    expect((await service.view(customer)).items).toHaveLength(0);
  });

  // A5: the preview unwraps the lookup and throws the REASON away — there is no order yet to
  // write a note on, so "not an agen" and "could not read" collapse back to the same
  // no-agen-price the preview always had. Exercised with a token, because without one the
  // service never calls the port at all.
  it('prices a preview for a signed-in caller without caring why there is no agen price', async () => {
    const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await service.setItem(customer, p.id, 1, false);

    const view = await service.view(customer, null, 'Bearer t');

    expect(view.items).toHaveLength(1);
    expect(view.reseller).toBeNull();
  });

  // A5, the other half: the preview must survive customer-service being down. It fails open
  // to no agen price — there is no order yet to write a note on — and the basket still
  // prices, because nobody should be stopped from seeing their cart by a pricing outage.
  it('still shows the basket when the agen read throws', async () => {
    const dead = {
      get: () => Promise.reject(new Error('customer-service down')),
      getFor: () => Promise.resolve(null),
    };
    const svc = buildCartService(cart, catalog, undefined, dead as never);
    const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await svc.setItem(customer, p.id, 2, false);

    const view = await svc.view(customer, null, 'Bearer t');

    expect(view.items).toHaveLength(1);
    expect(view.reseller).toBeNull();
  });
});
