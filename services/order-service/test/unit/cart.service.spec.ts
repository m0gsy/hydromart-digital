import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { ProductUnavailableError } from '../../src/domain/errors';
import { buildCartService, FakeProductCatalog, InMemoryCartRepository } from '../support/fakes';

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
