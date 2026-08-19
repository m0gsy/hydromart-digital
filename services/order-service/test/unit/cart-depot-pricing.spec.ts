import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import {
  FakeCashierShift,
  FakeCustomerDirectory,
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeForecastCoordination,
  FakeFranchiseRevenue,
  FakeInventory,
  FakeLoyaltyCoordination,
  FakeMembership,
  FakeNotification,
  FakePaymentReversal,
  FakeProductCatalog,
  FakePromo,
  FakeRecommendationCoordination,
  FakeReferralCoordination,
  FakeResellerDiscount,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  buildOutbox,
  buildTestConfig,
} from '../support/fakes';

/*
 * A1/A2/A4 — the cart must quote what checkout bills.
 *
 * These tests hold one line only: the cart and `priceLines` are ONE price, resolved once,
 * for one depot. Everything the customer reads before the button — the cart screen, the
 * checkout summary, the agen badge — is that number. They were two rules before: the cart
 * priced from `product.basePrice` and checkout from the depot's own row, and a Rp20.000
 * galon at a depot with a live +10% rule was quoted at Rp20.000 and billed at Rp22.000.
 *
 * The pair of services is built here on purpose. Asserting the cart's own arithmetic in
 * isolation is what let the two drift for as long as they did: each was right about
 * itself. Only running both against the same depot catches it.
 */

const address: DeliveryAddressSnapshot = {
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
  postalCode: '40111',
  latitude: -6.9,
  longitude: 107.6,
  notes: null,
};

const homeDepot = {
  id: 'depot-home',
  lat: -6.9,
  lng: 107.6,
  serviceRadiusKm: 10,
  deliveryFee: 5000,
  minOrderAmount: null,
};

describe('cart pricing agrees with checkout (A1/A2/A4)', () => {
  let orders: InMemoryOrderRepository;
  let cartRepo: InMemoryCartRepository;
  let catalog: FakeProductCatalog;
  let pricing: FakeDepotPricing;
  let resellerDiscount: FakeResellerDiscount;
  let cartService: CartService;
  let service: OrderService;
  let config: ReturnType<typeof buildTestConfig>;
  const customer = randomUUID();

  const build = (configOverrides: Record<string, string> = {}): void => {
    orders = new InMemoryOrderRepository();
    cartRepo = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    pricing = new FakeDepotPricing();
    resellerDiscount = new FakeResellerDiscount();
    const depots = new FakeDepotDirectory();
    depots.depots = [homeDepot];
    config = buildTestConfig(configOverrides);
    cartService = new CartService(cartRepo, catalog, pricing, resellerDiscount, config);
    service = new OrderService(
      orders,
      cartRepo,
      catalog,
      depots,
      pricing,
      new FakeLoyaltyCoordination(),
      new FakeReferralCoordination(),
      new FakeMembership(),
      resellerDiscount,
      new FakeCustomerDirectory(),
      new FakeNotification(),
      new FakePromo(),
      new FakeInventory(),
      cartService,
      config,
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      new FakeFranchiseRevenue(),
      new FakeCashierShift(),
      new FakePaymentReversal(),
      buildOutbox(orders),
    );
  };

  beforeEach(() => build());

  const seedGallon = async (basePrice: number, quantity: number): Promise<string> => {
    const p = catalog.seed({ id: randomUUID(), basePrice, isGallon: true });
    await cartService.setItem(customer, p.id, quantity, false, homeDepot.id);
    return p.id;
  };

  it('quotes the depot price, not the catalog price, when the depot has a rule', async () => {
    const productId = await seedGallon(20000, 2);
    pricing.setRule(homeDepot.id, productId, 'PERCENT', 10);

    const view = await cartService.view(customer, homeDepot.id);
    const order = await service.checkout(customer, { deliveryAddress: address });

    expect(view.items[0].unitPrice).toBe(22000);
    expect(view.subtotal).toBe(order.subtotal);
    expect(view.pricingBasis).toBe('DEPOT');
  });

  it('agrees with checkout on a static override AND a wholesale band', async () => {
    const productId = await seedGallon(20000, 10);
    pricing.setPrice(homeDepot.id, productId, 18000);
    pricing.setTier(homeDepot.id, productId, 10, 5500);

    const view = await cartService.view(customer, homeDepot.id);
    const order = await service.checkout(customer, { deliveryAddress: address });

    // The band wins outright — the number that used to be invisible until the receipt.
    expect(view.items[0].unitPrice).toBe(5500);
    expect(view.subtotal).toBe(order.subtotal);
  });

  it("says CATALOG rather than passing off base prices as the depot's", async () => {
    await seedGallon(20000, 2);

    const view = await cartService.view(customer, null);

    expect(view.pricingBasis).toBe('CATALOG');
    expect(view.subtotal).toBe(40000);
  });

  it('reports CATALOG when depot-service could not be reached', async () => {
    await seedGallon(20000, 2);
    pricing.unavailable = true;

    const view = await cartService.view(customer, homeDepot.id);

    expect(view.pricingBasis).toBe('CATALOG');
  });

  /*
   * A4. The badge was already on screen; the number beside it was not. The cart carries
   * the agen discount the order will actually apply, computed by the same helper, so the
   * screen can stop saying "dihitung saat pesan" over a total it contradicts.
   */
  it('previews the agen discount the order goes on to charge', async () => {
    const productId = await seedGallon(20000, 5);
    pricing.setRule(homeDepot.id, productId, 'PERCENT', 10);
    resellerDiscount.result = {
      active: true,
      discountPct: 0,
      flatGallonPriceIdr: 5000,
      homeDepotId: homeDepot.id,
    };

    const view = await cartService.view(customer, homeDepot.id, 'Bearer agen');
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer agen');

    expect(view.reseller?.applies).toBe(true);
    expect(view.reseller?.discount).toBe((22000 - 5000) * 5);
    expect(view.reseller?.discount).toBe(order.discount);
  });

  /*
   * A9's third copy. The server stopped pricing an agen outside their own depot; the
   * screen still promised it. The screen now reads the server's answer instead of
   * re-deriving one.
   */
  it('does not promise an agen price at a depot the agen is not registered at', async () => {
    await seedGallon(20000, 5);
    resellerDiscount.result = {
      active: true,
      discountPct: 0,
      flatGallonPriceIdr: 5000,
      homeDepotId: 'depot-somewhere-else',
    };

    const view = await cartService.view(customer, homeDepot.id, 'Bearer agen');

    expect(view.reseller?.applies).toBe(false);
    expect(view.reseller?.discount).toBe(0);
  });

  /*
   * The kill switch. A switch nobody has watched revert is not a switch, so this is the
   * proof that turning it off restores exactly the old behaviour and nothing else.
   */
  it('falls back to catalog prices when cartDepotPricing is off', async () => {
    build({ ORDER_CART_DEPOT_PRICING: '0' });
    const productId = await seedGallon(20000, 2);
    pricing.setRule(homeDepot.id, productId, 'PERCENT', 10);

    const view = await cartService.view(customer, homeDepot.id);

    expect(view.items[0].unitPrice).toBe(20000);
    expect(view.pricingBasis).toBe('CATALOG');
    // ...and the bill is still right, because checkout never asked this cart.
    const order = await service.checkout(customer, { deliveryAddress: address });
    expect(order.subtotal).toBe(44000);
  });
});
