import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import {
  BelowMinimumOrderError,
  CatalogUnavailableError,
  EmptyCartError,
  InsufficientStockError,
  InvalidStatusTransitionError,
  OrderNotCancellableError,
  OrderNotFoundError,
  OutOfServiceAreaError,
  ProductUnavailableError,
  VoucherRejectedError,
} from '../../src/domain/errors';
import { OrderStatus } from '../../src/domain/order-status';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import {
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeLoyaltyCoordination,
  FakeReferralCoordination,
  FakeMembership,
  FakeNotification,
  FakePromo,
  FakeInventory,
  FakeProductCatalog,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  buildTestConfig,
} from '../support/fakes';

const address: DeliveryAddressSnapshot = {
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
  postalCode: '40111',
  latitude: null,
  longitude: null,
  notes: null,
};

describe('OrderService', () => {
  let orders: InMemoryOrderRepository;
  let cart: InMemoryCartRepository;
  let catalog: FakeProductCatalog;
  let depots: FakeDepotDirectory;
  let pricing: FakeDepotPricing;
  let loyalty: FakeLoyaltyCoordination;
  let referral: FakeReferralCoordination;
  let membership: FakeMembership;
  let notification: FakeNotification;
  let promo: FakePromo;
  let inventory: FakeInventory;
  let cartService: CartService;
  let service: OrderService;
  const customer = randomUUID();

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    depots = new FakeDepotDirectory();
    pricing = new FakeDepotPricing();
    loyalty = new FakeLoyaltyCoordination();
    referral = new FakeReferralCoordination();
    membership = new FakeMembership();
    notification = new FakeNotification();
    promo = new FakePromo();
    inventory = new FakeInventory();
    cartService = new CartService(cart, catalog);
    service = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      pricing,
      loyalty,
      referral,
      membership,
      notification,
      promo,
      inventory,
      cartService,
      buildTestConfig(),
    );
  });

  const addToCart = async (basePrice: number, quantity: number): Promise<string> => {
    const p = catalog.seed({ id: randomUUID(), basePrice });
    await cartService.setItem(customer, p.id, quantity, false);
    return p.id;
  };

  it('checks out, snapshotting prices and applying the flat delivery fee', async () => {
    await addToCart(20000, 2);
    await addToCart(6000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });

    expect(order.status).toBe(OrderStatus.CREATED);
    expect(order.subtotal).toBe(46000);
    expect(order.deliveryFee).toBe(5000);
    expect(order.total).toBe(51000);
    expect(order.items).toHaveLength(2);
    expect(order.orderNumber).toMatch(/^HM-\d{8}-\d{6}$/);
    expect(order.recipientName).toBe('Budi');
    expect(order.history[0].status).toBe(OrderStatus.CREATED);
  });

  it('clears the cart after a successful checkout', async () => {
    await addToCart(20000, 1);
    await service.checkout(customer, { deliveryAddress: address });
    expect(await cart.findByCustomer(customer)).toHaveLength(0);
  });

  it('notifies the customer that the order was received at checkout', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    const received = notification.calls.find((c) => c.event === 'ORDER_RECEIVED');
    expect(received).toBeDefined();
    expect(received?.phone).toBe(order.phone);
    expect(received?.vars.orderNumber).toBe(order.orderNumber);
  });

  it('confirms a CREATED order when its payment settles, firing ORDER_CONFIRMED', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    notification.calls.length = 0;

    const confirmed = await service.confirmPaid(order.id, 'payment-service');
    expect(confirmed.status).toBe(OrderStatus.CONFIRMED);
    expect(notification.calls.map((c) => c.event)).toEqual(['ORDER_CONFIRMED']);
  });

  it('is a no-op when confirming a payment for an order already past CREATED (idempotent)', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    await service.confirmPaid(order.id, 'payment-service'); // CREATED→CONFIRMED
    notification.calls.length = 0;

    const again = await service.confirmPaid(order.id, 'payment-service');
    expect(again.status).toBe(OrderStatus.CONFIRMED);
    expect(notification.calls).toHaveLength(0);
  });

  it('rejects checkout with an empty cart', async () => {
    await expect(service.checkout(customer, { deliveryAddress: address })).rejects.toBeInstanceOf(
      EmptyCartError,
    );
  });

  it('ignores a client-supplied price — the catalog price wins', async () => {
    const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await cart.upsert(customer, p.id, 1);
    p.basePrice = 25000; // catalog raised the price after the item was carted
    const order = await service.checkout(customer, { deliveryAddress: address });
    expect(order.items[0].unitPrice).toBe(25000);
    expect(order.total).toBe(30000);
  });

  it('fails checkout when a carted product became unavailable', async () => {
    const p = catalog.seed({ id: randomUUID() });
    await cart.upsert(customer, p.id, 1);
    p.active = false;
    await expect(service.checkout(customer, { deliveryAddress: address })).rejects.toBeInstanceOf(
      ProductUnavailableError,
    );
  });

  it('fails closed when the catalog is unreachable at checkout', async () => {
    const p = catalog.seed({ id: randomUUID() });
    await cart.upsert(customer, p.id, 1);
    catalog.throwOnGet = true;
    await expect(service.checkout(customer, { deliveryAddress: address })).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });

  it('cancels an order before a driver is assigned but not after (BR-006)', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });

    const cancelled = await service.cancel(customer, order.id, 'changed mind');
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);

    await addToCart(20000, 1);
    const order2 = await service.checkout(customer, { deliveryAddress: address });
    await service.updateStatus(order2.id, OrderStatus.CONFIRMED, 'staff');
    await service.updateStatus(order2.id, OrderStatus.PREPARING, 'staff');
    await service.updateStatus(order2.id, OrderStatus.DRIVER_ASSIGNED, 'staff');
    await expect(service.cancel(customer, order2.id)).rejects.toBeInstanceOf(
      OrderNotCancellableError,
    );
  });

  it('applies a valid voucher discount and records the redemption', async () => {
    await addToCart(20000, 3); // subtotal 60000
    promo.quoteDiscount = 6000;
    const order = await service.checkout(
      customer,
      { deliveryAddress: address, voucherCode: 'hemat10' },
      'Bearer tok',
    );
    expect(order.discount).toBe(6000);
    expect(order.total).toBe(60000 + 5000 - 6000);
    expect(promo.redeemCalls).toHaveLength(1);
    expect(promo.redeemCalls[0]).toMatchObject({ code: 'HEMAT10', orderId: order.id });
  });

  it('rejects checkout (fail-closed) when a supplied voucher is invalid', async () => {
    await addToCart(20000, 1);
    promo.rejectQuote = true;
    await expect(
      service.checkout(customer, { deliveryAddress: address, voucherCode: 'BADCODE' }),
    ).rejects.toBeInstanceOf(VoucherRejectedError);
  });

  it('does not touch the promo-service when no voucher is supplied', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    expect(order.discount).toBe(0);
    expect(promo.redeemCalls).toHaveLength(0);
  });

  it('applies the membership tier discount on the subtotal (FR-032)', async () => {
    await addToCart(20000, 3); // subtotal 60000
    membership.rate = 0.05; // SILVER
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(3000);
    expect(order.total).toBe(60000 + 5000 - 3000);
  });

  it('stacks the membership discount with a voucher, capped at the subtotal', async () => {
    await addToCart(20000, 3); // subtotal 60000
    membership.rate = 0.05; // 3000
    promo.quoteDiscount = 6000;
    const order = await service.checkout(
      customer,
      { deliveryAddress: address, voucherCode: 'hemat10' },
      'Bearer tok',
    );
    expect(order.discount).toBe(9000); // 3000 + 6000
    expect(order.total).toBe(60000 + 5000 - 9000);
  });

  it('fails open on membership discount — no discount when loyalty is unavailable', async () => {
    await addToCart(20000, 3);
    membership.rate = 0; // adapter returns 0 on any error
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(0);
  });

  it('awards loyalty points once, only when the order completes (BR-013)', async () => {
    await addToCart(20000, 3); // subtotal 60000
    const order = await service.checkout(customer, { deliveryAddress: address });
    const flow = [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
    ];
    for (const s of flow) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }
    expect(loyalty.calls).toHaveLength(0); // nothing awarded before completion

    expect(referral.calls).toHaveLength(0); // nothing qualified before completion

    await service.updateStatus(order.id, OrderStatus.COMPLETED, 'staff', undefined, 'Bearer tok');
    expect(loyalty.calls).toHaveLength(1);
    expect(loyalty.calls[0]).toMatchObject({
      customerId: customer,
      orderId: order.id,
      subtotal: 60000,
      authorization: 'Bearer tok',
    });
    // FR-092: completion also qualifies any pending referral for this customer.
    expect(referral.calls).toHaveLength(1);
    expect(referral.calls[0]).toMatchObject({
      customerId: customer,
      orderId: order.id,
      authorization: 'Bearer tok',
    });
    // FR-093/094: order-received fires at checkout, then notable transitions notify the
    // customer (CONFIRMED, ON_DELIVERY, DELIVERED, COMPLETED); PREPARING/DRIVER_ASSIGNED/
    // PICKED_UP are silent.
    expect(notification.calls.map((c) => c.event)).toEqual([
      'ORDER_RECEIVED',
      'ORDER_CONFIRMED',
      'ORDER_ON_DELIVERY',
      'ORDER_DELIVERED',
      'ORDER_COMPLETED',
    ]);
    const confirmed = notification.calls[1];
    expect(confirmed).toMatchObject({
      phone: order.phone,
      customerId: customer,
      authorization: 'Bearer tok',
    });
    expect(confirmed.vars).toMatchObject({ orderNumber: order.orderNumber });
  });

  it('deducts routed-depot stock once, only when a routed order completes (FR-067..074)', async () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 5000, minOrderAmount: null },
    ];
    const productId = await addToCart(20000, 2);
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    const flow = [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
    ];
    for (const s of flow) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }
    expect(inventory.calls).toHaveLength(0); // nothing consumed before completion

    await service.updateStatus(order.id, OrderStatus.COMPLETED, 'staff', undefined, 'Bearer tok');
    expect(inventory.calls).toHaveLength(1);
    expect(inventory.calls[0]).toMatchObject({
      depotId: 'depot-near',
      orderId: order.id,
      authorization: 'Bearer tok',
    });
    expect(inventory.calls[0].items).toEqual([{ productId, quantity: 2 }]);
  });

  it('does not deduct stock when the order was not routed to a depot', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address }); // no coords
    const flow = [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ];
    for (const s of flow) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }
    expect(inventory.calls).toHaveLength(0);
  });

  const routedCheckout = () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 5000, minOrderAmount: null },
    ];
    return service.checkout(
      customer,
      { deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 } },
      'Bearer tok',
    );
  };

  it('reserves routed-depot stock at checkout (oversell prevention)', async () => {
    const productId = await addToCart(20000, 2);
    const order = await routedCheckout();
    expect(inventory.reserveCalls).toHaveLength(1);
    expect(inventory.reserveCalls[0]).toMatchObject({
      depotId: 'depot-near',
      orderId: order.id, // reservation is keyed by the pre-generated order id
      authorization: 'Bearer tok',
    });
    expect(inventory.reserveCalls[0].items).toEqual([{ productId, quantity: 2 }]);
  });

  it('does not reserve stock when the order is not routed to a depot', async () => {
    await addToCart(20000, 1);
    await service.checkout(customer, { deliveryAddress: address }); // no coords
    expect(inventory.reserveCalls).toHaveLength(0);
  });

  it('rejects checkout on a stock shortfall, creating no order and keeping the cart', async () => {
    await addToCart(20000, 2);
    inventory.reserveError = new InsufficientStockError();
    await expect(routedCheckout()).rejects.toBeInstanceOf(InsufficientStockError);
    expect(orders.rows).toHaveLength(0);
    expect(await cart.findByCustomer(customer)).toHaveLength(1); // cart untouched
  });

  it('releases held stock when a customer cancels (BR-006)', async () => {
    const productId = await addToCart(20000, 2);
    const order = await routedCheckout();
    await service.cancel(customer, order.id, 'changed mind', 'Bearer tok');
    expect(inventory.releaseCalls).toHaveLength(1);
    expect(inventory.releaseCalls[0]).toMatchObject({ depotId: 'depot-near', orderId: order.id });
    expect(inventory.releaseCalls[0].items).toEqual([{ productId, quantity: 2 }]);
  });

  it('releases held stock when staff cancel an order', async () => {
    await addToCart(20000, 2);
    const order = await routedCheckout();
    await service.updateStatus(order.id, OrderStatus.CANCELLED, 'staff', undefined, 'Bearer tok');
    expect(inventory.releaseCalls).toHaveLength(1);
  });

  it('expires abandoned CREATED orders, releasing their held stock', async () => {
    await addToCart(20000, 2);
    const order = await routedCheckout();
    orders.rows[0].createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // placed 2h ago
    const result = await service.expireAbandoned('admin', 'Bearer tok', 60);
    expect(result.cancelled).toBe(1);
    expect((await service.getAny(order.id)).status).toBe(OrderStatus.CANCELLED);
    expect(inventory.releaseCalls).toHaveLength(1);
  });

  it('leaves fresh and already-confirmed orders untouched when expiring', async () => {
    await addToCart(20000, 1);
    const fresh = await routedCheckout(); // createdAt = now
    await addToCart(20000, 1);
    const confirmed = await routedCheckout();
    orders.rows[1].createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await service.updateStatus(confirmed.id, OrderStatus.CONFIRMED, 'staff', undefined, 'Bearer tok');

    const result = await service.expireAbandoned('admin', 'Bearer tok', 60);
    expect(result.cancelled).toBe(0); // fresh is recent; confirmed is no longer CREATED
    expect((await service.getAny(fresh.id)).status).toBe(OrderStatus.CREATED);
    expect((await service.getAny(confirmed.id)).status).toBe(OrderStatus.CONFIRMED);
  });

  it('enforces the legal status sequence on staff updates (BR-012)', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    await expect(
      service.updateStatus(order.id, OrderStatus.PICKED_UP, 'staff'),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);

    const confirmed = await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'staff', 'ok');
    expect(confirmed.status).toBe(OrderStatus.CONFIRMED);
    expect(confirmed.history.at(-1)).toMatchObject({ status: OrderStatus.CONFIRMED, note: 'ok' });
  });

  it("never reveals another customer's order (cross-tenant 404)", async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    await expect(service.getForCustomer(randomUUID(), order.id)).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
  });

  it('repeats an order back into the cart', async () => {
    const productId = await addToCart(20000, 2);
    const order = await service.checkout(customer, { deliveryAddress: address });
    const view = await service.repeat(customer, order.id);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].productId).toBe(productId);
    expect(view.items[0].quantity).toBe(2);
  });

  it("lists only the requesting customer's orders", async () => {
    await addToCart(20000, 1);
    await service.checkout(customer, { deliveryAddress: address });
    const mine = await service.listForCustomer(customer, {});
    const others = await service.listForCustomer(randomUUID(), {});
    expect(mine.total).toBe(1);
    expect(others.total).toBe(0);
  });

  it('routes an order to the nearest in-range depot at checkout', async () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 7000, minOrderAmount: null }, // ~Bandung
      { id: 'depot-far', lat: -6.2, lng: 106.8, serviceRadiusKm: 10, deliveryFee: 9000, minOrderAmount: null }, // ~Jakarta
    ];
    await addToCart(20000, 1);
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    expect(order.depotId).toBe('depot-near');
  });

  it('charges the routed depot delivery fee instead of the flat config fee', async () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 8000, minOrderAmount: null },
    ];
    await addToCart(20000, 1);
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    expect(order.deliveryFee).toBe(8000);
    expect(order.total).toBe(28000);
  });

  it('rejects checkout when the subtotal is below the depot minimum', async () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 7000, minOrderAmount: 50000 },
    ];
    await addToCart(20000, 1);
    await expect(
      service.checkout(customer, {
        deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
      }),
    ).rejects.toThrow(BelowMinimumOrderError);
  });

  it('rejects checkout when depots exist but none covers the address (out of service area)', async () => {
    depots.depots = [
      { id: 'depot-far', lat: -6.2, lng: 106.8, serviceRadiusKm: 5, deliveryFee: 7000, minOrderAmount: 50000 },
    ];
    await addToCart(20000, 1);
    await expect(
      service.checkout(customer, {
        deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
      }),
    ).rejects.toBeInstanceOf(OutOfServiceAreaError);
  });

  it('stays fail-open (flat fee, unrouted) when the depot directory is unreachable', async () => {
    depots.unreachable = true;
    await addToCart(20000, 1);
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    expect(order.depotId).toBeNull();
    expect(order.deliveryFee).toBe(5000);
  });

  it('stays fail-open when no depots are configured at all', async () => {
    depots.depots = [];
    await addToCart(20000, 1);
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    expect(order.depotId).toBeNull();
    expect(order.deliveryFee).toBe(5000);
  });

  it('leaves an order unrouted when the address has no coordinates', async () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 7000, minOrderAmount: null },
    ];
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    expect(order.depotId).toBeNull();
  });

  it('prices lines from the routed depot override, not the catalog base', async () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 5000, minOrderAmount: null },
    ];
    const productId = await addToCart(20000, 2); // catalog base 20000
    pricing.setPrice('depot-near', productId, 22000); // this depot sells at 22000
    const order = await service.checkout(
      customer,
      { deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 } },
      'Bearer tok',
    );
    expect(order.items[0].unitPrice).toBe(22000);
    expect(order.subtotal).toBe(44000);
    expect(order.total).toBe(44000 + 5000);
  });

  it('falls back to the catalog base price when the depot has no override', async () => {
    depots.depots = [
      { id: 'depot-near', lat: -6.9, lng: 107.6, serviceRadiusKm: 10, deliveryFee: 5000, minOrderAmount: null },
    ];
    await addToCart(20000, 1); // no depot override set
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    expect(order.items[0].unitPrice).toBe(20000);
  });

  it('does not look up depot prices when the order is not routed', async () => {
    await addToCart(20000, 1);
    await service.checkout(customer, { deliveryAddress: address }); // no coords → unrouted
    expect(pricing.calls).toHaveLength(0);
  });
});
