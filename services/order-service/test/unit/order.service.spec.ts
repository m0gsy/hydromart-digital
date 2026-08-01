import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import {
  BelowMinimumOrderError,
  CatalogUnavailableError,
  DepotRequiredError,
  DepotUnavailableError,
  EmptyCartError,
  InsufficientStockError,
  InvalidStatusTransitionError,
  OrderAlreadyReviewedError,
  OrderAlreadyRoutedError,
  OrderNotCancellableError,
  OrderNotFoundError,
  OrderNotReviewableError,
  OutOfServiceAreaError,
  ProductUnavailableError,
  ResellerVoucherNotAllowedError,
  VoucherRejectedError,
} from '../../src/domain/errors';
import { OrderStatus } from '../../src/domain/order-status';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import {
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeLoyaltyCoordination,
  FakeReferralCoordination,
  FakeRecommendationCoordination,
  FakeForecastCoordination,
  FakeFranchiseRevenue,
  FakeMembership,
  FakeResellerDiscount,
  FakeNotification,
  FakePromo,
  FakeInventory,
  FakeProductCatalog,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  buildTestConfig,
} from '../support/fakes';

// Pinned address + a depot that covers it: checkout is fail-CLOSED now, so every
// test that just wants an order placed needs a routable address. Its fee matches
// the config fee the older tests asserted, so the money maths is unchanged.
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

/** Address with no map pin — the case that now forces an explicit depot choice. */
const unpinnedAddress: DeliveryAddressSnapshot = { ...address, latitude: null, longitude: null };

const homeDepot = {
  id: 'depot-home',
  lat: -6.9,
  lng: 107.6,
  serviceRadiusKm: 10,
  deliveryFee: 5000,
  minOrderAmount: null,
};

describe('OrderService', () => {
  let orders: InMemoryOrderRepository;
  let cart: InMemoryCartRepository;
  let catalog: FakeProductCatalog;
  let depots: FakeDepotDirectory;
  let pricing: FakeDepotPricing;
  let loyalty: FakeLoyaltyCoordination;
  let referral: FakeReferralCoordination;
  let recommendation: FakeRecommendationCoordination;
  let forecast: FakeForecastCoordination;
  let franchiseRevenue: FakeFranchiseRevenue;
  let membership: FakeMembership;
  let resellerDiscount: FakeResellerDiscount;
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
    depots.depots = [homeDepot];
    pricing = new FakeDepotPricing();
    loyalty = new FakeLoyaltyCoordination();
    referral = new FakeReferralCoordination();
    recommendation = new FakeRecommendationCoordination();
    forecast = new FakeForecastCoordination();
    franchiseRevenue = new FakeFranchiseRevenue();
    membership = new FakeMembership();
    resellerDiscount = new FakeResellerDiscount();
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
      resellerDiscount,
      notification,
      promo,
      inventory,
      cartService,
      buildTestConfig(),
      recommendation,
      forecast,
      franchiseRevenue,
    );
  });

  const addToCart = async (basePrice: number, quantity: number): Promise<string> => {
    const p = catalog.seed({ id: randomUUID(), basePrice });
    await cartService.setItem(customer, p.id, quantity, false);
    return p.id;
  };

  it('checks out, snapshotting prices and charging delivery per galon', async () => {
    await addToCart(20000, 2);
    await addToCart(6000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });

    expect(order.status).toBe(OrderStatus.CREATED);
    expect(order.subtotal).toBe(46000);
    expect(order.deliveryFee).toBe(5000 * 3); // Rp 5000/galon × 3 galons
    expect(order.total).toBe(46000 + 5000 * 3);
    expect(order.items).toHaveLength(2);
    expect(order.orderNumber).toMatch(/^HM-\d{8}-\d{6}$/);
    expect(order.recipientName).toBe('Budi');
    expect(order.history[0].status).toBe(OrderStatus.CREATED);
  });

  // The optional arguments every other test in this file happens to fill in, and the
  // fail-open catches that only fire when a coordination call actually throws.
  describe('omitted arguments and coordination failures', () => {
    const nearDepot = {
      id: 'depot-near',
      lat: -6.9,
      lng: 107.6,
      serviceRadiusKm: 10,
      deliveryFee: 5000,
      minOrderAmount: null,
    };

    it('treats a depot rule with no value as a zero adjustment', async () => {
      depots.depots = [nearDepot];
      const productId = await addToCart(20000, 1);
      pricing.setRule('depot-near', productId, 'PERCENT', null as never);
      const order = await service.checkout(
        customer,
        { deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 } },
        'Bearer tok',
      );
      expect(order.items[0].unitPrice).toBe(20000);
    });

    it('cancels without a reason and sweeps abandoned orders on the configured defaults', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address });
      const cancelled = await service.cancel(customer, order.id);
      expect(cancelled.status).toBe(OrderStatus.CANCELLED);

      await addToCart(20000, 1);
      await service.checkout(customer, { deliveryAddress: address });
      // No token, no explicit age: the sweep must read its own config.
      await expect(service.expireAbandoned('admin')).resolves.toMatchObject({
        cancelled: expect.any(Number),
      });
    });

    it('schedules a subscription delivery', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const order = await service.placeScheduled(
        customer,
        [{ productId: p.id, quantity: 1 }],
        address,
      );
      expect(order.subtotal).toBe(20000);
    });

    it('runs the reorder nudge on its default window and counts a failed send as not reminded', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address });
      orders.rows.find((r) => r.id === order.id)!.createdAt = new Date('2020-01-01T00:00:00.000Z');
      notification.notify = async () => {
        throw new Error('sms gateway down');
      };
      const out = await service.remindStaleCustomers(new Date());
      expect(out.reminded).toBe(0);
    });

    it('completes even when notification, recommendation and forecast all throw', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
      const fail = async (): Promise<never> => {
        throw new Error('downstream down');
      };
      for (const s of [
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.DRIVER_ASSIGNED,
        OrderStatus.PICKED_UP,
        OrderStatus.ON_DELIVERY,
        OrderStatus.DELIVERED,
      ]) {
        await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
      }
      // Only the completion fan-out is fail-open; the status-change notification is awaited,
      // so just the points message is made to fail here.
      const realNotify = notification.notify.bind(notification);
      notification.notify = async (event, phone, vars, customerId, authorization) => {
        if (event === 'POINTS_EARNED') throw new Error('downstream down');
        return realNotify(event, phone, vars, customerId, authorization);
      };
      recommendation.recordCompleted = fail;
      forecast.ingestCompletedOrder = fail;
      await expect(
        service.updateStatus(order.id, OrderStatus.COMPLETED, 'staff', undefined, 'Bearer tok'),
      ).resolves.toMatchObject({ status: OrderStatus.COMPLETED });
    });

    it('stamps the ETA the courier gave when going on delivery', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address });
      const eta = '2026-07-31T10:00:00.000Z';
      await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'staff');
      await service.updateStatus(order.id, OrderStatus.PREPARING, 'staff');
      await service.updateStatus(order.id, OrderStatus.DRIVER_ASSIGNED, 'staff');
      await service.updateStatus(order.id, OrderStatus.PICKED_UP, 'staff');
      const out = await service.updateStatus(
        order.id,
        OrderStatus.ON_DELIVERY,
        'staff',
        undefined,
        '',
        undefined,
        undefined,
        eta,
      );
      expect(out.estimatedArrivalAt).toEqual(new Date(eta));
    });

    it('exposes the depot sales total and per-customer aggregates other services read', async () => {
      await addToCart(20000, 1);
      await service.checkout(customer, { deliveryAddress: address });
      await expect(
        service.sumDepotSales('depot-near', new Date('2020-01-01'), new Date('2099-01-01')),
      ).resolves.toEqual(expect.any(Number));
      await expect(service.depotCustomerAggregates('depot-near')).resolves.toEqual(
        expect.any(Array),
      );
    });
  });

  it('batch-reads authoritative totals for existing order ids', async () => {
    await addToCart(20_000, 2);
    const order = await service.checkout(customer, { deliveryAddress: address });
    const missingId = randomUUID();

    const result = await (
      service as unknown as {
        findOrderValues(ids: string[]): Promise<{ orderId: string; totalIdr: number }[]>;
      }
    ).findOrderValues([order.id, missingId]);

    expect(result).toEqual([{ orderId: order.id, totalIdr: order.total }]);
  });

  it('round-trips an optional delivery window, defaulting to null when omitted', async () => {
    await addToCart(20000, 1);
    const withWindow = await service.checkout(customer, {
      deliveryAddress: address,
      deliveryWindow: '2026-07-20 09:00-12:00',
    });
    expect(withWindow.deliveryWindow).toBe('2026-07-20 09:00-12:00');
    expect((await service.getForCustomer(customer, withWindow.id)).deliveryWindow).toBe(
      '2026-07-20 09:00-12:00',
    );

    await addToCart(20000, 1);
    const without = await service.checkout(customer, { deliveryAddress: address });
    expect(without.deliveryWindow).toBeNull();
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

  it('reviews a delivered order once, then rejects a second review (spec 7c)', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });

    // Not reviewable while still in flight.
    await expect(
      service.reviewOrder(customer, order.id, { rating: 5, aspects: [] }),
    ).rejects.toBeInstanceOf(OrderNotReviewableError);

    for (const s of [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
    ]) {
      await service.updateStatus(order.id, s, 'staff');
    }

    const rev = await service.reviewOrder(customer, order.id, {
      rating: 4,
      aspects: ['speed', 'condition'],
      comment: '  mantap  ',
      tipAmount: 2000,
    });
    expect(rev.rating).toBe(4);
    expect(rev.comment).toBe('mantap'); // trimmed
    expect((await service.getForCustomer(customer, order.id)).reviewed).toBe(true);

    await expect(
      service.reviewOrder(customer, order.id, { rating: 3, aspects: [] }),
    ).rejects.toBeInstanceOf(OrderAlreadyReviewedError);
  });

  it('averages ratings over a batch of orders, null when none reviewed (design 4c)', async () => {
    const deliver = async (rating: number): Promise<string> => {
      await addToCart(20000, 1);
      const o = await service.checkout(customer, { deliveryAddress: address });
      for (const s of [
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.DRIVER_ASSIGNED,
        OrderStatus.PICKED_UP,
        OrderStatus.ON_DELIVERY,
        OrderStatus.DELIVERED,
      ]) {
        await service.updateStatus(o.id, s, 'staff');
      }
      await service.reviewOrder(customer, o.id, { rating, aspects: [] });
      return o.id;
    };
    const a = await deliver(5);
    const b = await deliver(4);

    expect(await service.ratingSummary([a, b])).toEqual({ average: 4.5, count: 2 });
    expect(await service.ratingSummary([])).toEqual({ average: null, count: 0 });
    expect(await service.ratingSummary([randomUUID()])).toEqual({ average: null, count: 0 });
  });

  it('reminds only customers whose last order is older than the window (spec 5h)', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    notification.calls.length = 0;

    // A "now" 30 days after the order, with a 14-day window → the order is stale.
    const future = new Date(order.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const res = await service.remindStaleCustomers(future, 14);
    expect(res.reminded).toBe(1);
    expect(notification.calls.map((c) => c.event)).toContain('REORDER_REMINDER');

    // Within the window → no reminder.
    notification.calls.length = 0;
    const soon = new Date(order.createdAt.getTime() + 24 * 60 * 60 * 1000);
    expect((await service.remindStaleCustomers(soon, 14)).reminded).toBe(0);
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
    expect(order.total).toBe(60000 + 5000 * 3 - 6000);
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
    expect(order.total).toBe(60000 + 5000 * 3 - 3000);
  });

  it('asks loyalty for the rate of the depot that fulfils the order', async () => {
    await addToCart(20000, 3);
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(membership.calls).toEqual([{ authorization: 'Bearer tok', depotId: order.depotId }]);
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
    expect(order.total).toBe(60000 + 5000 * 3 - 9000);
  });

  it('caps the value discount at the subtotal, never touching the delivery fee (M5-18)', async () => {
    await addToCart(20000, 3); // subtotal 60000, fee 15000
    membership.rate = 0.5; // 30000
    promo.quoteDiscount = 50000; // FIXED voucher; 30000 + 50000 would overshoot
    const order = await service.checkout(
      customer,
      { deliveryAddress: address, voucherCode: 'besar' },
      'Bearer tok',
    );
    expect(order.discount).toBe(60000); // capped at subtotal, fee untouched
    expect(order.total).toBe(5000 * 3); // customer still pays the full delivery fee
  });

  it('lets FREE_SHIPPING waive the whole fee even when it exceeds the subtotal (M5-18)', async () => {
    await addToCart(1000, 3); // subtotal 3000, fee 15000
    promo.quoteDiscount = 15000;
    promo.quoteDiscountType = 'FREE_SHIPPING';
    const order = await service.checkout(
      customer,
      { deliveryAddress: address, voucherCode: 'gratisongkir' },
      'Bearer tok',
    );
    expect(order.discount).toBe(15000); // whole fee waived, not clipped to subtotal
    expect(order.total).toBe(3000);
  });

  it('caps FREE_SHIPPING at the delivery fee and stacks it with a value discount (M5-18)', async () => {
    await addToCart(20000, 3); // subtotal 60000, fee 15000
    membership.rate = 0.05; // 3000
    promo.quoteDiscount = 99000; // over-generous FREE_SHIPPING quote
    promo.quoteDiscountType = 'FREE_SHIPPING';
    const order = await service.checkout(
      customer,
      { deliveryAddress: address, voucherCode: 'gratisongkir' },
      'Bearer tok',
    );
    expect(order.discount).toBe(3000 + 15000);
    expect(order.total).toBe(60000 + 15000 - 18000);
  });

  it('fails open on membership discount — no discount when loyalty is unavailable', async () => {
    await addToCart(20000, 3);
    membership.rate = 0; // adapter returns 0 on any error
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(0);
  });

  it('applies reseller percent discount and skips membership + voucher', async () => {
    await addToCart(20000, 1); // subtotal 20000
    resellerDiscount.result = { active: true, discountPct: 10 };
    membership.rate = 0.05; // must be ignored
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(2000); // 10% of 20000, membership 5% ignored
    expect(promo.quoteCalls).toHaveLength(0);
    expect(promo.redeemCalls).toHaveLength(0);
  });

  describe('wholesale band pricing (design 16b)', () => {
    const routed = { ...address, latitude: -6.91, longitude: 107.61 };
    const nearDepot = {
      id: 'depot-near',
      lat: -6.9,
      lng: 107.6,
      serviceRadiusKm: 10,
      deliveryFee: 0,
      minOrderAmount: null,
    };

    it('charges the band price once the quantity reaches the threshold', async () => {
      depots.depots = [nearDepot];
      const productId = await addToCart(22000, 10);
      pricing.setTier('depot-near', productId, 10, 5500);
      const order = await service.checkout(customer, { deliveryAddress: routed });
      expect(order.items[0]?.unitPrice).toBe(5500);
      expect(order.subtotal).toBe(55000);
    });

    it('leaves an order below the threshold at the normal price', async () => {
      depots.depots = [nearDepot];
      const productId = await addToCart(22000, 9);
      pricing.setTier('depot-near', productId, 10, 5500);
      const order = await service.checkout(customer, { deliveryAddress: routed });
      expect(order.items[0]?.unitPrice).toBe(22000);
    });

    it('outranks the depot override for that line', async () => {
      depots.depots = [nearDepot];
      const productId = await addToCart(22000, 10);
      pricing.setPrice('depot-near', productId, 19000);
      pricing.setTier('depot-near', productId, 10, 5500);
      const order = await service.checkout(customer, { deliveryAddress: routed });
      expect(order.items[0]?.unitPrice).toBe(5500);
    });

    it('does not stack the reseller percent on a band-priced line', async () => {
      depots.depots = [nearDepot];
      const productId = await addToCart(22000, 10);
      pricing.setTier('depot-near', productId, 10, 5500);
      resellerDiscount.result = { active: true, discountPct: 10 };
      const order = await service.checkout(customer, { deliveryAddress: routed }, 'Bearer tok');
      expect(order.subtotal).toBe(55000);
      expect(order.discount).toBe(0);
    });
  });

  it('rejects a voucher for an active reseller', async () => {
    await addToCart(20000, 1);
    resellerDiscount.result = { active: true, discountPct: 10 };
    await expect(
      service.checkout(
        customer,
        { deliveryAddress: address, voucherCode: 'hemat10' },
        'Bearer tok',
      ),
    ).rejects.toBeInstanceOf(ResellerVoucherNotAllowedError);
  });

  it('uses normal membership pricing when not a reseller', async () => {
    await addToCart(20000, 1);
    resellerDiscount.result = null;
    membership.rate = 0.05;
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(1000); // 5% of 20000
  });

  it('ignores a deactivated reseller and falls back to normal pricing', async () => {
    await addToCart(20000, 1);
    resellerDiscount.result = { active: false, discountPct: 10 };
    membership.rate = 0.05;
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(1000); // reseller gated off; membership applies instead
  });

  it('falls back to normal pricing when reseller lookup fails open (null)', async () => {
    await addToCart(20000, 1);
    resellerDiscount.result = null;
    promo.quoteDiscount = 500;
    const order = await service.checkout(
      customer,
      { deliveryAddress: address, voucherCode: 'hemat10' },
      'Bearer tok',
    );
    expect(order.discount).toBe(500); // voucher path still available
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

    expect(recommendation.calls).toHaveLength(0); // nothing recorded before completion
    expect(forecast.calls).toHaveLength(0); // forecast also idle before completion

    await service.updateStatus(order.id, OrderStatus.COMPLETED, 'staff', undefined, 'Bearer tok');
    expect(loyalty.calls).toHaveLength(1);
    expect(loyalty.calls[0]).toMatchObject({
      customerId: customer,
      orderId: order.id,
      subtotal: 60000,
      depotId: order.depotId,
      authorization: 'Bearer tok',
    });
    // FR-092: completion also qualifies any pending referral for this customer.
    expect(referral.calls).toHaveLength(1);
    expect(referral.calls[0]).toMatchObject({
      customerId: customer,
      orderId: order.id,
      authorization: 'Bearer tok',
    });
    // Completion also pushes the order into the recommendation-service read model.
    expect(recommendation.calls).toHaveLength(1);
    expect(recommendation.calls[0].orderId).toBe(order.id);
    expect(recommendation.calls[0].customerId).toBe(customer);
    expect(recommendation.calls[0].items).toEqual(
      order.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        unit: i.unit,
      })),
    );
    // Completion also feeds forecast-service (with per-item quantity for demand history).
    expect(forecast.calls).toHaveLength(1);
    expect(forecast.calls[0].orderId).toBe(order.id);
    expect(forecast.calls[0].customerId).toBe(customer);
    expect(forecast.calls[0].total).toBe(order.total);
    expect(forecast.calls[0].items).toEqual(
      order.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        unit: i.unit,
        quantity: i.quantity,
      })),
    );
    // FR-093/094: order-received fires at checkout, then notable transitions notify the
    // customer (CONFIRMED, ON_DELIVERY, DELIVERED, COMPLETED); PREPARING/DRIVER_ASSIGNED/
    // PICKED_UP are silent. On COMPLETED, POINTS_EARNED (spec 5h) fires just before the
    // generic ORDER_COMPLETED.
    expect(notification.calls.map((c) => c.event)).toEqual([
      'ORDER_RECEIVED',
      'ORDER_CONFIRMED',
      'ORDER_ON_DELIVERY',
      'ORDER_DELIVERED',
      'POINTS_EARNED',
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

  it('says nothing about points when loyalty could not report how many were awarded', async () => {
    // The count comes from loyalty (it owns the per-depot earn rate). Unknown means
    // unknown: promising a number this service made up is worse than staying silent.
    loyalty.pointsEarned = null;
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    for (const s of [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ]) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }
    expect(loyalty.calls).toHaveLength(1); // the award itself still happened
    expect(notification.calls.map((c) => c.event)).not.toContain('POINTS_EARNED');
  });

  it('deducts routed-depot stock once, only when a routed order completes (FR-067..074)', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 5000,
        minOrderAmount: null,
      },
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

  it('deducts stock at the depot the order was routed to, once it completes', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
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
    expect(inventory.calls).toHaveLength(1);
    expect(order.depotId).toBe(homeDepot.id);
  });

  const routedCheckout = () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 5000,
        minOrderAmount: null,
      },
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

  // An order with no depot is invisible to every depot queue and reserves no stock,
  // so checkout refuses one instead of placing it. These four cases are that contract.
  describe('an order always gets a depot', () => {
    it('refuses an unpinned address when the customer picked no depot', async () => {
      await addToCart(20000, 1);
      await expect(
        service.checkout(customer, { deliveryAddress: unpinnedAddress }),
      ).rejects.toBeInstanceOf(DepotRequiredError);
      expect(orders.rows).toHaveLength(0);
      expect(inventory.reserveCalls).toHaveLength(0);
      expect(await cart.findByCustomer(customer)).toHaveLength(1); // cart untouched
    });

    it('uses the depot the customer picked when the address has no pin', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, {
        deliveryAddress: unpinnedAddress,
        depotId: homeDepot.id,
      });
      expect(order.depotId).toBe(homeDepot.id);
      expect(inventory.reserveCalls).toHaveLength(1);
    });

    it('rejects a depot that is not in the active directory', async () => {
      await addToCart(20000, 1);
      await expect(
        service.checkout(customer, { deliveryAddress: unpinnedAddress, depotId: randomUUID() }),
      ).rejects.toBeInstanceOf(DepotUnavailableError);
    });

    // Legacy rows: orders placed back when checkout failed open. HQ has to be able to
    // find them (they match no depot filter) and route them by hand.
    describe('the HQ tray for orders that never reached a depot', () => {
      const unroute = async (): Promise<string> => {
        await addToCart(20000, 1);
        const order = await service.checkout(customer, { deliveryAddress: address });
        orders.rows.find((r) => r.id === order.id)!.depotId = null;
        return order.id;
      };

      it('lists only unrouted orders, ignoring any depot filter', async () => {
        const id = await unroute();
        await addToCart(20000, 1);
        await service.checkout(customer, { deliveryAddress: address }); // routed

        const tray = await service.listAll({ unrouted: true, depotIds: [homeDepot.id] });
        expect(tray.items.map((o) => o.id)).toEqual([id]);
      });

      it('releases no stock when cancelling one — none was ever held', async () => {
        const id = await unroute();
        await service.cancel(customer, id, 'changed mind', 'Bearer tok');
        expect(inventory.releaseCalls).toHaveLength(0);
      });

      it('assigns a depot, after which the order leaves the tray', async () => {
        const id = await unroute();
        const assigned = await service.assignDepot(id, homeDepot.id);
        expect(assigned.depotId).toBe(homeDepot.id);
        expect((await service.listAll({ unrouted: true })).items).toHaveLength(0);
      });

      it('refuses an unknown depot and refuses to move an already-routed order', async () => {
        const id = await unroute();
        await expect(service.assignDepot(id, randomUUID())).rejects.toBeInstanceOf(
          DepotUnavailableError,
        );
        await service.assignDepot(id, homeDepot.id);
        await expect(service.assignDepot(id, homeDepot.id)).rejects.toBeInstanceOf(
          OrderAlreadyRoutedError,
        );
      });
    });

    it('rejects checkout while the depot directory is unreachable', async () => {
      await addToCart(20000, 1);
      depots.unreachable = true;
      await expect(
        service.checkout(customer, { deliveryAddress: address }),
      ).rejects.toBeInstanceOf(DepotUnavailableError);
      expect(orders.rows).toHaveLength(0);
    });
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
    await service.updateStatus(
      confirmed.id,
      OrderStatus.CONFIRMED,
      'staff',
      undefined,
      'Bearer tok',
    );

    const result = await service.expireAbandoned('admin', 'Bearer tok', 60);
    expect(result.cancelled).toBe(0); // fresh is recent; confirmed is no longer CREATED
    expect((await service.getAny(fresh.id)).status).toBe(OrderStatus.CREATED);
    expect((await service.getAny(confirmed.id)).status).toBe(OrderStatus.CONFIRMED);
  });

  it('cancels an order stalled at the depot and gives back its stock', async () => {
    await addToCart(20000, 2);
    const order = await routedCheckout();
    await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'staff', undefined, 'Bearer tok');
    await service.updateStatus(order.id, OrderStatus.PREPARING, 'staff', undefined, 'Bearer tok');
    orders.rows[0].createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h, window is 24h

    const result = await service.expireAbandoned('admin', 'Bearer tok', 60);

    expect(result.cancelled).toBe(1);
    expect((await service.getAny(order.id)).status).toBe(OrderStatus.CANCELLED);
    expect(inventory.releaseCalls).toHaveLength(1);
  });

  it('leaves an order past a driver assignment to delivery-service, however old', async () => {
    await addToCart(20000, 2);
    const order = await routedCheckout();
    for (const s of [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.DRIVER_ASSIGNED]) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }
    orders.rows[0].createdAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    expect((await service.expireAbandoned('admin', 'Bearer tok', 60)).cancelled).toBe(0);
    expect((await service.getAny(order.id)).status).toBe(OrderStatus.DRIVER_ASSIGNED);
  });

  it('lets the system cancel a failed delivery mid-flight, releasing the hold', async () => {
    await addToCart(20000, 2);
    const order = await routedCheckout();
    for (const s of [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
    ]) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }
    const cancelled = await service.updateStatus(
      order.id,
      OrderStatus.CANCELLED,
      'courier',
      'Delivery failed',
      'Bearer tok',
    );
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(inventory.releaseCalls).toHaveLength(1);
  });

  it('still refuses a CUSTOMER cancel once a driver is assigned (BR-006)', async () => {
    await addToCart(20000, 2);
    const order = await routedCheckout();
    for (const s of [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.DRIVER_ASSIGNED]) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }
    await expect(service.cancel(customer, order.id)).rejects.toBeInstanceOf(
      OrderNotCancellableError,
    );
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

  it('filters the staff queue by depotId, and returns all depots when omitted (6a)', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 7000,
        minOrderAmount: null,
      }, // ~Bandung
      {
        id: 'depot-far',
        lat: -6.2,
        lng: 106.8,
        serviceRadiusKm: 10,
        deliveryFee: 9000,
        minOrderAmount: null,
      }, // ~Jakarta
    ];
    await addToCart(20000, 1);
    const near = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    await addToCart(20000, 1);
    const far = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.21, longitude: 106.81 },
    });
    expect(near.depotId).toBe('depot-near');
    expect(far.depotId).toBe('depot-far');

    const all = await service.listAll({});
    expect(all.total).toBe(2);

    const onlyNear = await service.listAll({ depotIds: ['depot-near'] });
    expect(onlyNear.total).toBe(1);
    expect(onlyNear.items[0].id).toBe(near.id);
  });

  it('routes an order to the nearest in-range depot at checkout', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 7000,
        minOrderAmount: null,
      }, // ~Bandung
      {
        id: 'depot-far',
        lat: -6.2,
        lng: 106.8,
        serviceRadiusKm: 10,
        deliveryFee: 9000,
        minOrderAmount: null,
      }, // ~Jakarta
    ];
    await addToCart(20000, 1);
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    expect(order.depotId).toBe('depot-near');
  });

  it('charges the routed depot delivery fee instead of the flat config fee', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 8000,
        minOrderAmount: null,
      },
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
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 7000,
        minOrderAmount: 50000,
      },
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
      {
        id: 'depot-far',
        lat: -6.2,
        lng: 106.8,
        serviceRadiusKm: 5,
        deliveryFee: 7000,
        minOrderAmount: 50000,
      },
    ];
    await addToCart(20000, 1);
    await expect(
      service.checkout(customer, {
        deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
      }),
    ).rejects.toBeInstanceOf(OutOfServiceAreaError);
  });

  // These three used to assert fail-open (order placed with depotId null). That is
  // exactly the bug that lost live orders, so the contract flipped: no depot, no order.
  it('rejects checkout when the depot directory is unreachable', async () => {
    depots.unreachable = true;
    await addToCart(20000, 1);
    await expect(
      service.checkout(customer, {
        deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
      }),
    ).rejects.toBeInstanceOf(DepotUnavailableError);
  });

  it('rejects checkout when no depots are configured at all', async () => {
    depots.depots = [];
    await addToCart(20000, 1);
    await expect(
      service.checkout(customer, {
        deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
      }),
    ).rejects.toBeInstanceOf(DepotUnavailableError);
  });

  it('asks for a depot when the address has no coordinates', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 7000,
        minOrderAmount: null,
      },
    ];
    await addToCart(20000, 1);
    await expect(
      service.checkout(customer, { deliveryAddress: unpinnedAddress }),
    ).rejects.toBeInstanceOf(DepotRequiredError);
    // ...and the picked depot's own fee applies once the customer chooses it.
    const order = await service.checkout(customer, {
      deliveryAddress: unpinnedAddress,
      depotId: 'depot-near',
    });
    expect(order.depotId).toBe('depot-near');
    expect(order.deliveryFee).toBe(7000);
  });

  it('prices lines from the routed depot override, not the catalog base', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 5000,
        minOrderAmount: null,
      },
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
    expect(order.total).toBe(44000 + 5000 * 2); // 2 galons
  });

  it('applies an active depot pricing rule to the unit price at checkout', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 5000,
        minOrderAmount: null,
      },
    ];
    const productId = await addToCart(20000, 2); // catalog base 20000, no sellPrice override
    pricing.setRule('depot-near', productId, 'PERCENT', -10); // 10% off -> 18000
    const order = await service.checkout(
      customer,
      { deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 } },
      'Bearer tok',
    );
    expect(order.items[0].unitPrice).toBe(18000);
    expect(order.subtotal).toBe(36000);
    expect(order.total).toBe(36000 + 5000 * 2); // 2 galons
  });

  it('falls back to the catalog base price when the depot has no override', async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 5000,
        minOrderAmount: null,
      },
    ];
    await addToCart(20000, 1); // no depot override set
    const order = await service.checkout(customer, {
      deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 },
    });
    expect(order.items[0].unitPrice).toBe(20000);
  });

  it('looks up depot prices for the depot the customer picked', async () => {
    await addToCart(20000, 1);
    await service.checkout(customer, {
      deliveryAddress: unpinnedAddress,
      depotId: homeDepot.id,
    });
    expect(pricing.calls).toHaveLength(1);
    expect(pricing.calls[0].depotId).toBe(homeDepot.id);
  });

  const coordAddress: DeliveryAddressSnapshot = { ...address, latitude: -6.91, longitude: 107.61 };

  it("placeScheduled routes to a depot: reserves stock, uses depot pricing and the depot's discount rate", async () => {
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 5000,
        minOrderAmount: null,
      },
    ];
    const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    pricing.setPrice('depot-near', p.id, 22000); // depot sells at 22000

    const order = await service.placeScheduled(
      customer,
      [{ productId: p.id, quantity: 2 }],
      coordAddress,
    ); // 5% subscription discount — the depot's setting, env default in buildTestConfig

    expect(order.depotId).toBe('depot-near');
    expect(order.subtotal).toBe(44000); // 22000 × 2 (depot price, not catalog base)
    expect(order.discount).toBe(2200); // 5% of 44000
    expect(order.deliveryFee).toBe(5000 * 2); // 2 galons
    expect(order.total).toBe(44000 + 10000 - 2200);
    // routed → stock reserved for oversell prevention
    expect(inventory.reserveCalls).toHaveLength(1);
    expect(inventory.reserveCalls[0]).toMatchObject({ depotId: 'depot-near', orderId: order.id });
    expect(inventory.reserveCalls[0].items).toEqual([{ productId: p.id, quantity: 2 }]);
  });

  it('placeScheduled quotes the subscription discount against the ROUTED depot', async () => {
    // The rate used to be a 5% constant passed in by the sweep. It is a per-depot setting
    // now, so what matters is that the depot doing the delivery is the one asked.
    const config = buildTestConfig();
    const spy = jest.spyOn(config, 'subscriptionDiscountRate').mockReturnValue(0.1);
    const service = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      pricing,
      loyalty,
      referral,
      membership,
      resellerDiscount,
      notification,
      promo,
      inventory,
      cartService,
      config,
      recommendation,
      forecast,
      franchiseRevenue,
    );
    depots.depots = [
      {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 0,
        minOrderAmount: null,
      },
    ];
    const p = catalog.seed({ id: randomUUID(), basePrice: 10000 });

    const order = await service.placeScheduled(
      customer,
      [{ productId: p.id, quantity: 2 }],
      coordAddress,
    );

    expect(spy).toHaveBeenCalledWith('depot-near');
    expect(order.discount).toBe(2000); // 10% of 20000, the depot's rate — not a fixed 5%
  });

  it('placeScheduled rejects an empty line list', async () => {
    await expect(service.placeScheduled(customer, [], coordAddress)).rejects.toBeInstanceOf(
      EmptyCartError,
    );
  });

  const deliver = async (): Promise<string> => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    for (const s of [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
    ]) {
      await service.updateStatus(order.id, s, 'staff');
    }
    return order.id;
  };

  it('getReview returns null before a review exists, then the review once submitted', async () => {
    const orderId = await deliver();
    expect(await service.getReview(customer, orderId)).toBeNull();

    await service.reviewOrder(customer, orderId, { rating: 5, aspects: [], comment: 'Cepat' });
    const review = await service.getReview(customer, orderId);
    expect(review).toMatchObject({ rating: 5, comment: 'Cepat' });
  });

  it('getReview enforces ownership (404 for another customer)', async () => {
    const orderId = await deliver();
    await expect(service.getReview(randomUUID(), orderId)).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
  });

  it('recordRefund persists a refund amount and 404s on an unknown order', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    await expect(service.recordRefund(order.id, 15000)).resolves.toBeUndefined();
    await expect(service.recordRefund(randomUUID(), 15000)).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
  });
});

describe('OrderService franchise revenue on completion', () => {
  // Kept separate from the big lifecycle suite: this needs a routed depot WITH an owner,
  // which the shared setup deliberately does not have.
  const routedAddress = {
    recipientName: 'Budi',
    phone: '+628111',
    addressLine: 'Jl. Mawar 1',
    city: 'Bandung',
    province: 'Jawa Barat',
    postalCode: '40111',
    latitude: -6.9,
    longitude: 107.6,
    notes: null,
  };
  const depot = {
    id: 'depot-owned',
    lat: -6.9,
    lng: 107.6,
    serviceRadiusKm: 10,
    deliveryFee: 5000,
    minOrderAmount: null,
  };

  async function build(withOwner: boolean) {
    const orders = new InMemoryOrderRepository();
    const cart = new InMemoryCartRepository();
    const catalog = new FakeProductCatalog();
    const depots = new FakeDepotDirectory();
    const revenue = new FakeFranchiseRevenue();
    depots.depots = [depot];
    if (withOwner) depots.owners.set(depot.id, 'owner-9');
    const cartService = new CartService(cart, catalog);
    const service = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      new FakeDepotPricing(),
      new FakeLoyaltyCoordination(),
      new FakeReferralCoordination(),
      new FakeMembership(),
      new FakeResellerDiscount(),
      new FakeNotification(),
      new FakePromo(),
      new FakeInventory(),
      cartService,
      buildTestConfig(),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      revenue,
    );
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await cartService.setItem('cust-rev', product.id, 3, false);
    const order = await service.checkout('cust-rev', { deliveryAddress: routedAddress });
    return { service, order, revenue };
  }

  async function complete(service: OrderService, orderId: string): Promise<void> {
    for (const s of [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ]) {
      await service.updateStatus(orderId, s, 'staff', undefined, 'Bearer tok');
    }
  }

  it('credits the depot owner with the order total exactly once, and not before completion', async () => {
    const { service, order, revenue } = await build(true);
    await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'staff', undefined, 'Bearer tok');
    expect(revenue.posted).toHaveLength(0);

    for (const s of [
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ]) {
      await service.updateStatus(order.id, s, 'staff', undefined, 'Bearer tok');
    }

    expect(revenue.posted).toHaveLength(1);
    expect(revenue.posted[0]).toMatchObject({
      orderId: order.id,
      orderNumber: order.orderNumber,
      franchiseOwnerId: 'owner-9',
      depotId: depot.id,
      amountIdr: order.total,
    });
  });

  it('posts nothing when the depot has no franchise owner', async () => {
    const { service, order, revenue } = await build(false);
    await complete(service, order.id);
    expect(revenue.posted).toHaveLength(0);
  });

  it('completes normally when the payout push throws', async () => {
    const { service, order, revenue } = await build(true);
    revenue.orderCompleted = async () => {
      throw new Error('payout down');
    };
    await expect(complete(service, order.id)).resolves.not.toThrow();
  });
});
