import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { OutboxService } from '../../src/application/services/outbox.service';
import {
  BelowMinimumOrderError,
  ExpressUnavailableError,
  CatalogUnavailableError,
  DepotRequiredError,
  DepotUnavailableError,
  DuplicateCheckoutError,
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
  StaleOrderStatusError,
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
  FakeGallonIssue,
  FakeCashierShift,
  FakePaymentReversal,
  FakeMembership,
  FakeResellerDiscount,
  FakeCustomerDirectory,
  FakeNotification,
  FakePromo,
  FakeInventory,
  FakeProductCatalog,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  buildCartService,
  buildOutbox,
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
  let gallonIssue: FakeGallonIssue;
  let membership: FakeMembership;
  let resellerDiscount: FakeResellerDiscount;
  let customerDirectory: FakeCustomerDirectory;
  let notification: FakeNotification;
  let promo: FakePromo;
  let inventory: FakeInventory;
  let cartService: CartService;
  let service: OrderService;
  let outbox: OutboxService;
  let reversal: FakePaymentReversal;
  const customer = randomUUID();
  // Held rather than passed inline: the express tests need to change what the depot has
  // configured, which is a property of the config, not of the service.
  let config: ReturnType<typeof buildTestConfig>;

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
    gallonIssue = new FakeGallonIssue();
    membership = new FakeMembership();
    resellerDiscount = new FakeResellerDiscount();
    customerDirectory = new FakeCustomerDirectory();
    notification = new FakeNotification();
    promo = new FakePromo();
    inventory = new FakeInventory();
    cartService = buildCartService(cart, catalog, pricing, resellerDiscount, config);
    outbox = buildOutbox(orders);
    config = buildTestConfig();
    reversal = new FakePaymentReversal();
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
      customerDirectory,
      notification,
      promo,
      inventory,
      cartService,
      config,
      recommendation,
      forecast,
      franchiseRevenue,
      gallonIssue,
      new FakeCashierShift(),
      reversal,
      outbox,
    );
  });

  const addToCart = async (basePrice: number, quantity: number): Promise<string> => {
    const p = catalog.seed({ id: randomUUID(), basePrice });
    await cartService.setItem(customer, p.id, quantity, false);
    return p.id;
  };

  /*
   * K2.3 — a cancelled order gives the money back, instead of a sentence saying it will.
   *
   * Cancellation never reached payment-service on ANY of its three paths: the customer's
   * own cancel, staff/delivery-service through `changeStatus`, and the abandoned-order
   * sweep. All three released the stock and left the payment exactly where it was — so a
   * PENDING row went on blocking every other payment method for that order, a PAID row
   * stayed revenue the depot no longer had, and the staff screen showed a red panel
   * explaining the refund rule. A paragraph, not a refund.
   *
   * The call goes BEFORE the status write and fails closed, because the two failure states
   * are not equally bad: an order that refused to cancel can be cancelled again in a
   * minute, while an order recorded as cancelled whose money is still held is a customer
   * who paid for nothing.
   */
  describe('cancellation settles the payment (K2.3)', () => {
    const placeOrder = async (): Promise<string> => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address });
      return order.id;
    };

    it('settles the money leg when the customer cancels', async () => {
      const id = await placeOrder();
      const cancelled = await service.cancel(customer, id, 'ganti hari');
      expect(cancelled.status).toBe(OrderStatus.CANCELLED);
      expect(reversal.cancels).toEqual([{ orderId: id, reason: 'ganti hari' }]);
      // Not a counter void — the two are different endpoints for a reason.
      expect(reversal.calls).toHaveLength(0);
    });

    it('refuses to cancel at all when the money cannot be settled', async () => {
      const id = await placeOrder();
      reversal.cancelError = new Error('payment-service unreachable');
      await expect(service.cancel(customer, id, 'ganti hari')).rejects.toThrow();
      // The order is still live. Cancelled-and-unrefunded is the one state that must not
      // exist, and this is what keeps it from existing.
      expect((await service.getForCustomer(customer, id)).status).not.toBe(OrderStatus.CANCELLED);
    });

    it('settles it for a staff or delivery-service cancellation too', async () => {
      const id = await placeOrder();
      await service.updateStatus(id, OrderStatus.CANCELLED, 'staff-1', 'stok habis');
      expect(reversal.cancels).toEqual([{ orderId: id, reason: 'stok habis' }]);
    });

    it('leaves other transitions alone', async () => {
      const id = await placeOrder();
      await service.updateStatus(id, OrderStatus.CONFIRMED, 'staff-1');
      expect(reversal.cancels).toHaveLength(0);
    });

    it('the abandoned sweep leaves an order LIVE when its payment cannot be settled', async () => {
      const id = await placeOrder();
      orders.rows.find((r) => r.id === id)!.createdAt = new Date(Date.now() - 90 * 60_000);
      reversal.cancelError = new Error('payment-service unreachable');

      // J7: nothing cancelled and something failed — the scheduler must not read this as a
      // quiet round, because sweep.sh writes its heartbeat off exactly this field.
      expect(await service.expireAbandoned('system:scheduler')).toEqual({
        cancelled: 0,
        failed: 1,
        ok: false,
      });
      expect((await service.getForCustomer(customer, id)).status).not.toBe(OrderStatus.CANCELLED);
    });

    it('the abandoned sweep cancels and settles when the money leg answers', async () => {
      const id = await placeOrder();
      orders.rows.find((r) => r.id === id)!.createdAt = new Date(Date.now() - 90 * 60_000);
      expect(await service.expireAbandoned('system:scheduler')).toEqual({
        cancelled: 1,
        failed: 0,
        ok: true,
      });
      expect(reversal.cancels.map((c) => c.orderId)).toEqual([id]);
    });
  });


  // The reconciliation reads litres off the ORDER LINE, not the live catalog. If the
  // snapshot ever stops being written, every meter comparison silently reports the
  // whole day's production as unaccounted-for water. These two guard that.
  // Failing open is still right — nobody should be stopped from buying water because a
  // pricing service blinked — but the order used to carry no sign it had happened, so a
  // wrongly-priced order only turned up as a money difference at reconciliation.
  describe('catalog pricing fallback leaves a trace', () => {
    it('marks an order priced from the catalog because the depot was unreachable', async () => {
      await addToCart(20000, 2);
      pricing.unavailable = true;

      const order = await service.checkout(customer, { deliveryAddress: address });

      expect(orders.notes).toEqual([
        {
          id: order.id,
          status: order.status,
          changedBy: 'order-service',
          note: 'Harga dasar katalog dipakai: depot tidak terjangkau saat checkout',
        },
      ]);
    });

    it('says nothing when the depot answered', async () => {
      await addToCart(20000, 1);

      await service.checkout(customer, { deliveryAddress: address });

      expect(orders.notes).toEqual([]);
    });

    /*
     * E-5. The tier discount fails open to 0, which is right — a loyalty outage must not
     * stop somebody buying water. What was wrong is that it left NOTHING behind: a PLATINUM
     * customer paid full price and no note, ledger or log tied to the order could say why.
     */
    it('marks an order priced without the tier discount because loyalty was unreachable', async () => {
      await addToCart(20000, 2);
      membership.rate = 0.1;
      membership.unavailable = true;

      const order = await service.checkout(customer, { deliveryAddress: address });

      expect(orders.notes).toEqual([
        {
          id: order.id,
          status: order.status,
          changedBy: 'order-service',
          note: 'Diskon membership tidak dihitung: loyalty-service tidak terjangkau saat checkout',
        },
      ]);
    });

    // The other half: a customer whose tier is genuinely worth nothing is not an outage,
    // and stamping every REGULAR checkout would bury the note that matters.
    it('says nothing when loyalty answered that the tier is worth nothing', async () => {
      await addToCart(20000, 1);
      membership.rate = 0;
      membership.unavailable = false;

      await service.checkout(customer, { deliveryAddress: address });

      expect(orders.notes).toEqual([]);
    });

    // A subscription delivery is placed by a sweep with nobody watching it, so the note on
    // the order is the ONLY trace that it was billed from the catalog instead of the depot.
    it('marks a scheduled delivery the same way', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      pricing.unavailable = true;

      const order = await service.placeScheduled(
        customer,
        [{ productId: p.id, quantity: 2 }],
        address,
      );

      expect(orders.notes).toEqual([
        {
          id: order.id,
          status: order.status,
          changedBy: 'order-service',
          note: 'Harga dasar katalog dipakai: depot tidak terjangkau saat checkout',
        },
      ]);
    });

    // Fail-open all the way down: an order already placed and paid for must not unwind
    // because the marker could not be written.
    it('still places the order when the marker cannot be written', async () => {
      await addToCart(20000, 1);
      pricing.unavailable = true;
      orders.appendNote = async () => {
        throw new Error('history table down');
      };

      await expect(
        service.checkout(customer, { deliveryAddress: address }),
      ).resolves.toBeDefined();
    });
  });

  describe('catalog volume snapshot', () => {
    it('freezes volumeMl and isGallon onto each checked-out line', async () => {
      const galon = catalog.seed({
        id: randomUUID(),
        basePrice: 20000,
        unit: 'Galon 19L',
        volumeMl: 19000,
        isGallon: true,
      });
      const botol = catalog.seed({
        id: randomUUID(),
        basePrice: 6000,
        unit: 'Dus 24x600ml',
        volumeMl: 14400,
        isGallon: false,
      });
      await cartService.setItem(customer, galon.id, 2, false);
      await cartService.setItem(customer, botol.id, 1, false);

      const order = await service.checkout(customer, { deliveryAddress: address });
      const galonLine = order.items.find((i) => i.productId === galon.id)!;
      const botolLine = order.items.find((i) => i.productId === botol.id)!;
      expect(galonLine).toMatchObject({ volumeMl: 19000, isGallon: true });
      expect(botolLine).toMatchObject({ volumeMl: 14400, isGallon: false });
      // Only the galon line pays the per-galon delivery fee.
      expect(order.deliveryFee).toBe(5000 * 2);
    });

    it('keeps an unmeasured catalog line unmeasured rather than defaulting it to zero', async () => {
      const cap = catalog.seed({
        id: randomUUID(),
        basePrice: 5000,
        unit: 'Pak',
        volumeMl: null,
        isGallon: false,
      });
      await cartService.setItem(customer, cap.id, 3, false);
      const order = await service.checkout(customer, { deliveryAddress: address });
      expect(order.items[0].volumeMl).toBeNull();
      expect(order.items[0].isGallon).toBe(false);
    });
  });

  it('checks out, snapshotting prices and charging delivery per galon', async () => {
    await addToCart(20000, 2);
    await addToCart(6000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });

    expect(order.status).toBe(OrderStatus.CREATED);
    expect(order.subtotal).toBe(46000);
    expect(order.deliveryFee).toBe(5000 * 3); // Rp 5000/galon × 3 galons
    expect(order.total).toBe(46000 + 5000 * 3);
    expect(order.items).toHaveLength(2);
    // 6+ digits, not exactly 6: the suffix is a counter now, and truncating it back to
    // six would put the collision it was built to remove straight back in.
    expect(order.orderNumber).toMatch(/^HM-\d{8}-\d{6,}$/);
    expect(order.recipientName).toBe('Budi');
    expect(order.history[0].status).toBe(OrderStatus.CREATED);
  });

  // H-4. Transitions were read-check-write: the legality check ran against a row read
  // moments earlier, so two staff acting together both passed it and both wrote. The
  // second write also re-ran the completion fan-out — stock consumed twice, points
  // awarded twice, franchise revenue posted twice.
  describe('concurrent status transitions', () => {
    const advance = async (order: { id: string }, to: OrderStatus) =>
      service.updateStatus(order.id, to, 'staff', undefined, 'Bearer tok');

    it('lets one of two simultaneous transitions win and tells the other', async () => {
      await addToCart(20000, 2);
      const order = await service.checkout(customer, { deliveryAddress: address });

      const results = await Promise.allSettled([
        advance(order, OrderStatus.CONFIRMED),
        advance(order, OrderStatus.CANCELLED),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(StaleOrderStatusError);
    });

    it('runs the completion fan-out once when COMPLETED is applied twice', async () => {
      await addToCart(20000, 2);
      const order = await service.checkout(customer, { deliveryAddress: address });
      for (const s of [
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.DRIVER_ASSIGNED,
        OrderStatus.PICKED_UP,
        OrderStatus.ON_DELIVERY,
        OrderStatus.DELIVERED,
      ]) {
        await advance(order, s);
      }

      const results = await Promise.allSettled([
        advance(order, OrderStatus.COMPLETED),
        advance(order, OrderStatus.COMPLETED),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      // The consume is the depot's stock leaving. Twice would be a real shortfall.
      expect(inventory.calls).toHaveLength(1);
      expect(loyalty.calls).toHaveLength(1);
    });
  });

  // H-10. Stock consume, the loyalty award, the referral qualification and the
  // franchise-owner credit were fire-and-forget calls behind a swallowed catch. A
  // depot-service blip meant the checkout hold was never settled and the depot's sellable
  // stock drifted down forever; a payout blip meant an owner was never paid for a sale.
  // Nothing retried, and a log line was the only trace.
  describe('durable completion effects', () => {
    const complete = async () => {
      await addToCart(20000, 2);
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
      return order;
    };

    it('keeps owing the stock consume when depot-service is down, and lands it on the sweep', async () => {
      inventory.consume = async () => {
        throw new Error('depot-service down');
      };
      const order = await complete();

      const owed = orders.outbox!.rows.find((r) => r.topic === 'INVENTORY_CONSUME')!;
      expect(owed).toMatchObject({ orderId: order.id, status: 'PENDING', attempts: 1 });
      expect(inventory.calls).toHaveLength(0);

      // depot-service comes back; the sweep settles the hold that completion could not.
      const consumed: string[] = [];
      inventory.consume = async (_d, orderId) => {
        consumed.push(orderId);
      };
      const swept = await outbox.processDue(new Date(Date.now() + 60 * 60 * 1000));

      expect(swept.delivered).toBe(1);
      expect(consumed).toEqual([order.id]);
      expect(orders.outbox!.rows.find((r) => r.topic === 'INVENTORY_CONSUME')!.status).toBe('DONE');
    });

    it('gives up loudly rather than retrying forever', async () => {
      inventory.consume = async () => {
        throw new Error('depot-service down');
      };
      await complete();

      // Six attempts, backing off; the seventh sweep would find nothing left to try.
      let at = Date.now();
      for (let i = 0; i < 6; i += 1) {
        at += 60 * 60 * 1000;
        await outbox.processDue(new Date(at));
      }

      const row = orders.outbox!.rows.find((r) => r.topic === 'INVENTORY_CONSUME')!;
      expect(row.status).toBe('DEAD');
      expect(await outbox.pending()).toMatchObject({ DEAD: 1 });
    });

    // A legacy unrouted row can still reach COMPLETED, and the sweep has to settle its
    // consume rather than retry forever against a depot that is not there.
    it('settles the owed consume of an order that has no depot, without touching stock', async () => {
      inventory.consume = async () => {
        throw new Error('depot-service down');
      };
      const order = await complete();
      orders.rows.find((r) => r.id === order.id)!.depotId = null;

      const consumed: string[] = [];
      inventory.consume = async (_d, orderId) => {
        consumed.push(orderId);
      };
      const swept = await outbox.processDue(new Date(Date.now() + 60 * 60 * 1000));

      expect(swept.delivered).toBe(1);
      expect(consumed).toEqual([]);
      expect(orders.outbox!.rows.find((r) => r.topic === 'INVENTORY_CONSUME')!.status).toBe('DONE');
    });

    // `GALLON_ISSUE` joined this list in I1, and the list is the point of the test: a
    // completing order owes exactly these effects, durably. The fixture sells a gallon, so
    // it owes the deposit booking too — the ledger that every later refund is measured
    // against used to be written by nobody, which is why courier returns refunded Rp0.
    it('marks every effect delivered on the happy path', async () => {
      await complete();

      const rows = orders.outbox!.rows;
      expect(rows.map((r) => r.topic).sort()).toEqual([
        'FRANCHISE_REVENUE',
        'GALLON_ISSUE',
        'INVENTORY_CONSUME',
        'LOYALTY_AWARD',
        'REFERRAL_QUALIFY',
      ]);
      expect(rows.every((r) => r.status === 'DONE')).toBe(true);
    });

    // The other half of the same rule: an order that carried no gallons owes no deposit
    // booking. Without this, "every completed order books a deposit" would pass just as
    // happily and the depot's outstanding balance would grow on sales of nothing physical.
    it('owes no gallon booking when the order carried no gallons (I1)', async () => {
      const dry = catalog.seed({ id: randomUUID(), basePrice: 15000, isGallon: false });
      await cartService.setItem(customer, dry.id, 1, false);
      const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
      for (const st of [
        OrderStatus.CONFIRMED,
        OrderStatus.PREPARING,
        OrderStatus.DRIVER_ASSIGNED,
        OrderStatus.PICKED_UP,
        OrderStatus.ON_DELIVERY,
        OrderStatus.DELIVERED,
        OrderStatus.COMPLETED,
      ]) {
        await service.updateStatus(order.id, st, 'staff', undefined, 'Bearer tok');
      }

      const topics = orders.outbox!.rows.filter((r) => r.orderId === order.id).map((r) => r.topic);
      expect(topics).not.toContain('GALLON_ISSUE');
      expect(gallonIssue.booked).toHaveLength(0);
    });

    // I1 books gallons out with the deposit DERIVED at the depot, so nothing here names
    // money. What this pins is the shape depot-service is handed — the depot it goes to,
    // the order it is keyed by (that key is the idempotency), and the count.
    it('books the gallons a completed order carried out (I1)', async () => {
      const order = await complete();

      expect(gallonIssue.booked).toEqual([
        {
          depotId: order.depotId,
          orderId: order.id,
          customerId: customer,
          quantity: expect.any(Number),
        },
      ]);
      expect(gallonIssue.booked[0].quantity).toBeGreaterThan(0);
    });

    // The reason this effect is in the outbox rather than in the fail-open fan-out. A
    // swallowed failure is a deposit the depot holds in fact and not in its book, and the
    // next courier return then refunds Rp0 — the very bug I1 exists to close. It has to
    // stay PENDING and be retried.
    it('keeps the gallon booking owed when depot-service is down (I1)', async () => {
      gallonIssue.error = new Error('depot-service down');
      const order = await complete();

      const row = orders.outbox!.rows.find(
        (r) => r.orderId === order.id && r.topic === 'GALLON_ISSUE',
      )!;
      expect(row.status).toBe('PENDING');

      gallonIssue.error = null;
      await outbox.processDue(new Date(Date.now() + 60 * 60 * 1000));
      expect(gallonIssue.booked).toHaveLength(1);
      expect(
        orders.outbox!.rows.find((r) => r.orderId === order.id && r.topic === 'GALLON_ISSUE')!
          .status,
      ).toBe('DONE');
    });
  });

  // B-13. A double-tapped Bayar, or a retry after the proxy gave up on a request the
  // server had already committed, used to place a second order — a second hold on the
  // depot's stock and a second bill for the same water.
  describe('checkout idempotency', () => {
    const key = 'checkout-attempt-1';

    it('returns the first order when the same Idempotency-Key is retried', async () => {
      await addToCart(20000, 2);

      const first = await service.checkout(customer, { deliveryAddress: address, idempotencyKey: key });
      // The retry finds an empty cart — checkout clears it — so a service that did not
      // recognise the key would not merely double-order here, it would throw.
      const second = await service.checkout(customer, { deliveryAddress: address, idempotencyKey: key });

      expect(second.id).toBe(first.id);
      expect(orders.rows).toHaveLength(1);
      // One order, one hold: the replay must not reserve stock a second time.
      expect(inventory.reserveCalls).toHaveLength(1);
    });

    it('places one order when two taps race past the pre-check, and releases the loser hold', async () => {
      await addToCart(20000, 2);

      const [a, b] = await Promise.all([
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key }),
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key }),
      ]);

      expect(orders.rows).toHaveLength(1);
      expect(a.id).toBe(b.id);
      expect(a.id).toBe(orders.rows[0].id);
      // Both taps reserved; the one the unique index rejected handed its stock straight back.
      expect(inventory.reserveCalls).toHaveLength(2);
      expect(inventory.releaseCalls).toHaveLength(1);
      expect(inventory.releaseCalls[0].orderId).not.toBe(a.id);
    });

    /*
     * K2.5 — the loser of the race has ALREADY burned the voucher.
     *
     * `reserveThenCreate` burns before it writes the row (B-6: a burn that fails must abort
     * the checkout rather than hand out an unpaid discount), against an id it generated so
     * stock could be held. When the unique index picks the other tap as the winner, that id
     * never becomes an order — but the redemption against it stands. The voucher is spent,
     * on an order number that does not exist, and neither the customer nor support can see
     * where it went. Documented in the code for months, never fixed.
     */
    it('hands the voucher back when its tap loses the race (K2.5)', async () => {
      await addToCart(20000, 2);
      promo.quoteDiscount = 5000;

      const [a, b] = await Promise.all([
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key, voucherCode: 'HEMAT10' }),
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key, voucherCode: 'HEMAT10' }),
      ]);

      expect(orders.rows).toHaveLength(1);
      expect(a.id).toBe(b.id);
      // Both taps burned it; exactly the one that produced no order gives it back.
      expect(promo.redeemCalls).toHaveLength(2);
      expect(promo.releaseCalls).toHaveLength(1);
      expect(promo.releaseCalls[0]).not.toBe(a.id);
      expect(promo.redeemCalls.map((r) => r.orderId)).toContain(promo.releaseCalls[0]);
    });

    it('hands it back when the winner cannot be read back either', async () => {
      await addToCart(20000, 2);
      promo.quoteDiscount = 5000;
      jest.spyOn(orders, 'findByIdempotencyKey').mockResolvedValue(null);
      jest.spyOn(orders, 'create').mockRejectedValue(new DuplicateCheckoutError());

      await expect(
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key, voucherCode: 'HEMAT10' }),
      ).rejects.toBeInstanceOf(DuplicateCheckoutError);
      expect(promo.releaseCalls).toHaveLength(1);
    });

    it('lets the checkout fail with its own reason when handing the voucher back also fails', async () => {
      await addToCart(20000, 2);
      promo.quoteDiscount = 5000;
      promo.releaseError = new Error('promo-service down');
      jest.spyOn(orders, 'findByIdempotencyKey').mockResolvedValue(null);
      jest.spyOn(orders, 'create').mockRejectedValue(new DuplicateCheckoutError());

      // Fail-open: the caller sees why their checkout failed, never a second failure on
      // the way out. (The voucher stays burned in that case — a stuck redemption is worse
      // reported than a wrong error, and promo-service being down is its own alert.)
      await expect(
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key, voucherCode: 'HEMAT10' }),
      ).rejects.toBeInstanceOf(DuplicateCheckoutError);
    });

    it('releases nothing when no voucher was in play', async () => {
      await addToCart(20000, 2);
      jest.spyOn(orders, 'create').mockRejectedValue(new DuplicateCheckoutError());
      await expect(
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key }),
      ).rejects.toBeInstanceOf(DuplicateCheckoutError);
      expect(promo.releaseCalls).toHaveLength(0);
    });

    it('still places separate orders when no key is sent', async () => {
      await addToCart(20000, 2);
      await service.checkout(customer, { deliveryAddress: address });
      await addToCart(20000, 1);
      await service.checkout(customer, { deliveryAddress: address });

      expect(orders.rows).toHaveLength(2);
    });

    it('treats a blank key as no key rather than as one every order shares', async () => {
      await addToCart(20000, 2);
      await service.checkout(customer, { deliveryAddress: address, idempotencyKey: '  ' });
      await addToCart(20000, 1);
      await service.checkout(customer, { deliveryAddress: address, idempotencyKey: '' });

      expect(orders.rows).toHaveLength(2);
    });

    it('surfaces the conflict when the winning order cannot be read back', async () => {
      // Losing the race and then finding nothing means the winner is not visible to this
      // connection. Answering with a fabricated success would be worse than a 409.
      await addToCart(20000, 2);
      jest.spyOn(orders, 'findByIdempotencyKey').mockResolvedValue(null);
      jest.spyOn(orders, 'create').mockRejectedValue(new DuplicateCheckoutError());

      await expect(
        service.checkout(customer, { deliveryAddress: address, idempotencyKey: key }),
      ).rejects.toBeInstanceOf(DuplicateCheckoutError);
      // The hold that attempt took is still handed back.
      expect(inventory.releaseCalls).toHaveLength(1);
    });

    /**
     * D6 · a subscription delivery has to be traceable back to the subscription.
     *
     * The only link was the idempotency string the sweep happens to build —
     * `sub:<id>:<iso>` — which is exposed on no read model and is not something anybody can
     * query. "Which orders did this subscription produce?" had no answer, and D1 needs one:
     * excluding scheduled orders from the abandonment sweep by pattern-matching a string
     * would rest a money predicate on a naming convention.
     *
     * The column ships one release AHEAD of the code that reads it (schema release rule),
     * so nothing in this PR consumes it yet.
     */
    it('D6 · records which subscription placed a scheduled delivery', async () => {
      const subscriptionId = randomUUID();
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });

      const order = await service.placeScheduled(
        customer,
        [{ productId: product.id, quantity: 2 }],
        address,
        `sub:${subscriptionId}:2026-09-01T00:00:00.000Z`,
        subscriptionId,
      );

      expect(order.subscriptionId).toBe(subscriptionId);
    });

    it('D6 · leaves it null for a scheduled order placed without one', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const order = await service.placeScheduled(
        customer,
        [{ productId: product.id, quantity: 1 }],
        address,
      );
      expect(order.subscriptionId ?? null).toBeNull();
    });

    // The subscription sweep keys each due delivery the same way (H-3); a re-triggered
    // sweep must get the delivery it already placed, not a second one.
    it('returns the same scheduled order when a sweep replays its key', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const lines = [{ productId: product.id, quantity: 2 }];

      const first = await service.placeScheduled(customer, lines, address, 'sub:s1:2026-07-01');
      const again = await service.placeScheduled(customer, lines, address, 'sub:s1:2026-07-01');

      expect(again.id).toBe(first.id);
      expect(orders.rows).toHaveLength(1);
    });

    it('scopes the key to the customer who sent it', async () => {
      const other = randomUUID();
      const product = await addToCart(20000, 2);
      await service.checkout(customer, { deliveryAddress: address, idempotencyKey: key });
      await cartService.setItem(other, product, 1, false);

      const theirs = await service.checkout(other, { deliveryAddress: address, idempotencyKey: key });

      expect(orders.rows).toHaveLength(2);
      expect(theirs.customerId).toBe(other);
    });
  });

  // H-12: the suffix used to be randomInt(0, 1e6) against a UNIQUE column, so a
  // collision was a failed checkout for a real customer — ~40% of days at 1,000
  // orders/day. A counter cannot collide, so this asserts distinctness directly
  // rather than sampling a probability.
  it('never issues the same order number twice, even under concurrent checkout', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    const numbers = await Promise.all(
      Array.from({ length: 25 }, async (_, i) => {
        const buyer = `cust-seq-${i}`;
        await cartService.setItem(buyer, product.id, 1, false);
        return (await service.checkout(buyer, { deliveryAddress: address })).orderNumber;
      }),
    );
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  // H-16: the date part came from getUTC*, so every order placed between 00:00 and
  // 07:00 WIB was stamped with the previous day.
  it('stamps the WIB calendar date, not the UTC one', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T19:00:00Z')); // 02:00 WIB, 4 Aug
    try {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address });
      expect(order.orderNumber.slice(0, 11)).toBe('HM-20260804');
    } finally {
      jest.useRealTimers();
    }
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
      // J7: `{ reminded: 0 }` alone was the same answer as "nobody was due", and
      // `sweep.sh` wrote the scheduler heartbeat for both. A round that reached nobody
      // and lost somebody now says so, and the heartbeat is withheld.
      expect(out).toEqual({ reminded: 0, failed: 1, ok: false });
    });

    it('J7 · a round with nobody due is ok, and says nothing failed', async () => {
      await expect(service.remindStaleCustomers(new Date('2020-01-02T00:00:00.000Z'))).resolves.toEqual({
        reminded: 0,
        failed: 0,
        ok: true,
      });
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

    it('returns one customer’s orders at one depot, and nothing from another depot', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address });
      const depotId = order.depotId as string;

      await expect(service.customerOrdersAtDepot(depotId, customer)).resolves.toEqual([
        expect.objectContaining({ id: order.id }),
      ]);
      // Depot-scoped: the same customer at a depot they never bought from is empty.
      await expect(service.customerOrdersAtDepot(randomUUID(), customer)).resolves.toEqual([]);
      // ...and so is a different customer at the right depot.
      await expect(service.customerOrdersAtDepot(depotId, randomUUID())).resolves.toEqual([]);
    });

    it('clamps the limit into [1, 50] rather than trusting the caller', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address });
      const depotId = order.depotId as string;

      await expect(service.customerOrdersAtDepot(depotId, customer, 0)).resolves.toHaveLength(1);
      await expect(service.customerOrdersAtDepot(depotId, customer, 9999)).resolves.toHaveLength(1);
    });
  });

  it('batch-reads authoritative totals for existing order ids', async () => {
    await addToCart(20_000, 2);
    const order = await service.checkout(customer, { deliveryAddress: address });
    const missingId = randomUUID();

    const result = await (
      service as unknown as {
        findOrderValues(
          ids: string[],
        ): Promise<{ orderId: string; orderNumber: string; totalIdr: number }[]>;
      }
    ).findOrderValues([order.id, missingId]);

    expect(result).toEqual([
      { orderId: order.id, orderNumber: order.orderNumber, totalIdr: order.total },
    ]);
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

  /*
   * K2.4 — the cancel window REOPENS after a reschedule. A failed attempt sends the order
   * back to PREPARING so dispatch can hand it to another courier, and BR-006 reads the
   * status alone: an order whose goods already left the depot, rode around and came back
   * becomes customer-cancellable again, and cancelling releases stock that has physically
   * moved. The right of cancellation ends when the goods leave, not when a status happens
   * to read PREPARING again.
   */
  it('does not reopen the cancel window after an order has already been dispatched (K2.4)', async () => {
    await addToCart(20000, 1);
    const order = await service.checkout(customer, { deliveryAddress: address });
    await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'staff');
    await service.updateStatus(order.id, OrderStatus.PREPARING, 'staff');
    await service.updateStatus(order.id, OrderStatus.DRIVER_ASSIGNED, 'staff');
    await service.updateStatus(order.id, OrderStatus.PICKED_UP, 'staff');
    await service.updateStatus(order.id, OrderStatus.ON_DELIVERY, 'staff');
    // The attempt failed; the delivery service hands the order back to the queue.
    await service.updateStatus(order.id, OrderStatus.PREPARING, 'staff');

    await expect(service.cancel(customer, order.id)).rejects.toBeInstanceOf(
      OrderNotCancellableError,
    );
  });

  /*
   * O6 — a new order reached nobody at the depot.
   *
   * The only emission when an order is created is the CUSTOMER's "we have your order".
   * There was no ops event for it at all, the ops feed has no depot column to filter by,
   * and depot staff could not open that feed anyway — while the ops settings screen has
   * shown them a "Pesanan baru masuk (depot)" toggle, defaulted ON, the whole time. A
   * promise in the UI with nothing behind it.
   */
  describe('O6 · the depot hears about its own new order', () => {
    it('emits a depot-addressed event on checkout, carrying the depot', async () => {
      await addToCart(20000, 2);
      const order = await service.checkout(customer, { deliveryAddress: address });

      const ops = notification.calls.filter((c) => c.event === 'DEPOT_ORDER_INCOMING');
      expect(ops).toHaveLength(1);
      expect(ops[0].depotId).toBe(order.depotId);
      expect(ops[0].vars.orderNumber).toBe(order.orderNumber);
      // Addressed to a depot, not to a person: no customer id rides with it, or crm would
      // push the depot's alert to the buyer's phone.
      expect(ops[0].customerId).toBeNull();
    });

    it('still sends the customer their own confirmation', async () => {
      await addToCart(20000, 2);
      await service.checkout(customer, { deliveryAddress: address });
      expect(notification.calls.some((c) => c.event === 'ORDER_RECEIVED')).toBe(true);
    });

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
    expect(res).toEqual({ reminded: 1, failed: 0, ok: true });
    expect(notification.calls.map((c) => c.event)).toContain('REORDER_REMINDER');

    // Within the window → no reminder.
    notification.calls.length = 0;
    const soon = new Date(order.createdAt.getTime() + 24 * 60 * 60 * 1000);
    expect((await service.remindStaleCustomers(soon, 14)).reminded).toBe(0);
  });

  // Audit S-2 / S-22, and the Q-17 baseline row for checkout. Seven upstream calls used to
  // be waited out one after another. The pairs below need nothing from each other, so the
  // assertion is on OVERLAP — a peak of one would mean somebody re-sequenced them.
  it('prices and reseller status are fetched together', async () => {
    let inFlight = 0;
    let peak = 0;
    const overlap = (target: Record<string, unknown>, key: string): void => {
      const original = (target[key] as (...args: unknown[]) => Promise<unknown>).bind(target);
      target[key] = async (...args: unknown[]) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          // One real tick, so a sequential implementation cannot look concurrent.
          await new Promise((resolve) => setTimeout(resolve, 1));
          return await original(...args);
        } finally {
          inFlight -= 1;
        }
      };
    };
    for (const [target, key] of [
      [pricing, 'getPrices'],
      [catalog, 'getProduct'],
      [resellerDiscount, 'get'],
      [membership, 'getDiscountRate'],
      [promo, 'quote'],
    ] as unknown as [Record<string, unknown>, string][]) {
      overlap(target, key);
    }

    await addToCart(20000, 3);
    promo.quoteDiscount = 6000;
    await service.checkout(
      customer,
      { deliveryAddress: address, voucherCode: 'hemat10' },
      'Bearer tok',
    );

    expect(peak).toBeGreaterThanOrEqual(2);
  });

  // The membership rate is documented fail-open, and running it alongside the voucher quote
  // must not change that: a broken adapter reads as a 0% tier, not a failed checkout.
  it('prices at zero membership discount when the tier lookup throws', async () => {
    await addToCart(20000, 2);
    jest.spyOn(membership, 'getDiscountRate').mockRejectedValue(new Error('loyalty down'));
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(0);
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

  /*
   * A9 at checkout. Same rule as the counter, same reason: an agen enrolled at depot A used
   * to draw their agen price ordering from depot B, franchises included.
   */
  it('refuses reseller pricing when the agen belongs to a different depot', async () => {
    await addToCart(20000, 1);
    resellerDiscount.result = {
      active: true,
      discountPct: 10,
      flatGallonPriceIdr: 0,
      homeDepotId: 'depot-somewhere-else',
    };
    membership.rate = 0;
    const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
    expect(order.discount).toBe(0);
  });

  it('applies reseller percent discount and skips membership + voucher', async () => {
    await addToCart(20000, 1); // subtotal 20000
    resellerDiscount.result = { active: true, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: 'depot-home' };
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
      resellerDiscount.result = { active: true, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: 'depot-home' };
      const order = await service.checkout(customer, { deliveryAddress: routed }, 'Bearer tok');
      expect(order.subtotal).toBe(55000);
      expect(order.discount).toBe(0);
    });
  });

  // Depot SOP §5: an agen pays a flat Rp5.000 per galon, whatever the galon lists at.
  describe('flat reseller galon price', () => {
    it('discounts each galon line down to the flat price', async () => {
      await addToCart(8000, 3); // 3 × Rp8.000 = 24.000 listed
      resellerDiscount.result = { active: true, discountPct: 0, flatGallonPriceIdr: 5000, homeDepotId: 'depot-home' };
      membership.rate = 0.05; // must be ignored — reseller pricing replaces it
      const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
      expect(order.subtotal).toBe(24000);
      expect(order.discount).toBe(9000); // (8000 − 5000) × 3
    });

    // Without `flatGallonPriceIdr` in the isReseller test, this reseller falls through to
    // the membership+voucher path and is never charged the agen price at all.
    it('is a reseller even with no discount percent at all', async () => {
      await addToCart(8000, 1);
      resellerDiscount.result = { active: true, discountPct: 0, flatGallonPriceIdr: 5000, homeDepotId: 'depot-home' };
      membership.rate = 0.05;
      const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
      expect(order.discount).toBe(3000); // flat price, not 5% membership (400)
      expect(promo.quoteCalls).toHaveLength(0);
    });

    it('wins over the percentage when both are set', async () => {
      await addToCart(8000, 1);
      resellerDiscount.result = { active: true, discountPct: 10, flatGallonPriceIdr: 5000, homeDepotId: 'depot-home' };
      const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
      expect(order.discount).toBe(3000); // not 800
    });

    it('never marks a line up that already sits below the flat price', async () => {
      await addToCart(4000, 2);
      resellerDiscount.result = { active: true, discountPct: 0, flatGallonPriceIdr: 5000, homeDepotId: 'depot-home' };
      const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
      expect(order.discount).toBe(0);
    });

    it('leaves non-galon lines at list price', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 8000, isGallon: false });
      await cartService.setItem(customer, p.id, 2, false);
      resellerDiscount.result = { active: true, discountPct: 0, flatGallonPriceIdr: 5000, homeDepotId: 'depot-home' };
      const order = await service.checkout(customer, { deliveryAddress: address }, 'Bearer tok');
      expect(order.discount).toBe(0);
    });

    it('skips a band-priced galon line — it is already at the bulk price', async () => {
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
      const productId = await addToCart(8000, 10);
      pricing.setTier('depot-near', productId, 10, 5500);
      resellerDiscount.result = { active: true, discountPct: 0, flatGallonPriceIdr: 5000, homeDepotId: 'depot-home' };
      const order = await service.checkout(
        customer,
        { deliveryAddress: { ...address, latitude: -6.91, longitude: 107.61 } },
        'Bearer tok',
      );
      expect(order.subtotal).toBe(55000);
      expect(order.discount).toBe(0);
    });
  });

  it('rejects a voucher for an active reseller', async () => {
    await addToCart(20000, 1);
    resellerDiscount.result = { active: true, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: 'depot-home' };
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
    resellerDiscount.result = { active: false, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: 'depot-home' };
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
    /*
     * FR-093/094 — and B6 moved two of these, in opposite directions.
     *
     * ORDER_DRIVER_ASSIGNED is new. It was filed under "intermediate state, silent", which
     * it is not to the customer: it is the exact moment BR-006 ends their own right to
     * cancel. The button stopped being there and nothing said why.
     *
     * ORDER_COMPLETED is gone from this sequence, and its absence is the point. Proof of
     * delivery marches DELIVERED then COMPLETED in one loop, so the customer was getting
     * THREE messages at the door — "sudah sampai", "selesai, poin sudah ditambahkan", and
     * POINTS_EARNED with the actual number. Two were about points and only one knew how
     * many. DELIVERED is the news, POINTS_EARNED is the number; the middle one was neither.
     *
     * COMPLETED reached any other way still speaks — see order-status.spec.
     */
    // O6 added a message addressed to the DEPOT, not to the door. This assertion is about
    // what the CUSTOMER hears, so it reads the customer-addressed calls — a depot alert
    // landing here would have made "three messages at one door" true again by accident.
    expect(notification.calls.filter((c) => c.customerId !== null).map((c) => c.event)).toEqual([
      'ORDER_RECEIVED',
      'ORDER_CONFIRMED',
      'ORDER_DRIVER_ASSIGNED',
      'ORDER_ON_DELIVERY',
      'ORDER_DELIVERED',
      'POINTS_EARNED',
    ]);
    const confirmed = notification.calls.filter((c) => c.customerId !== null)[1];
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

      /*
       * K2.7 — routing an order to a depot IS the promise that the depot will fill it, so
       * the stock is held when the promise is made.
       *
       * This reverses a decision the code used to defend in a comment: "stock is NOT
       * reserved retroactively ... the operator checks availability when they pick the order
       * up". That last clause describes a mechanism that does not exist — the operator queue
       * shows no availability at all — so nobody was checking anything, and the shortfall
       * surfaced hours later at `consumeForOrder` instead.
       */
      it('holds the stock at the depot it routes the order to', async () => {
        const id = await unroute();
        // `unroute()` checks out first and then clears the depot, so the checkout's own
        // reserve is already on the record. What is under test is the SECOND one.
        inventory.reserveCalls.length = 0;
        await service.assignDepot(id, homeDepot.id, 'Bearer tok');
        expect(inventory.reserveCalls).toHaveLength(1);
        expect(inventory.reserveCalls[0]).toMatchObject({
          depotId: homeDepot.id,
          orderId: id,
          authorization: 'Bearer tok',
        });
      });

      // Fails CLOSED and BEFORE the write: an order recorded at a depot that cannot fill it
      // is not undone by the operator trying again, and the refusal has to arrive while
      // somebody is still on the screen to pick a different depot.
      it('refuses the routing when the depot cannot cover the order, leaving it in the tray', async () => {
        const id = await unroute();
        inventory.reserveError = new Error('Insufficient stock at the fulfilling depot');
        await expect(service.assignDepot(id, homeDepot.id, 'Bearer tok')).rejects.toThrow(
          'Insufficient stock',
        );
        expect((await service.listAll({ unrouted: true })).items.map((o) => o.id)).toEqual([id]);
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

      // Fail closed while the directory is down: routing an order into a depot nobody can
      // confirm is active would hand it to a depot that may no longer be trading.
      it('refuses to route while the depot directory is unreachable', async () => {
        const id = await unroute();
        depots.unreachable = true;
        await expect(service.assignDepot(id, homeDepot.id)).rejects.toBeInstanceOf(
          DepotUnavailableError,
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

  /**
   * D1: a scheduled delivery has nobody at a keyboard to confirm it, and payment is direct
   * to the depot — so neither window's premise holds for it. CREATED beyond `abandonMinutes`
   * means "the customer walked away"; there is no customer here. CONFIRMED beyond
   * `stalledHours` is the second window, which is why being born CONFIRMED would only have
   * moved the problem rather than fixed it. Both are asserted, because an exclusion that
   * covers one still cancels the delivery a few hours later.
   */
  it('never sweeps a subscription delivery, in either window (D1)', async () => {
    const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    const order = await service.placeScheduled(
      customer,
      [{ productId: p.id, quantity: 1 }],
      address,
      'sub:s-1:2026-08-20T00:00:00.000Z',
      's-1',
    );
    const age = (): void => {
      orders.rows.find((r) => r.id === order.id)!.createdAt = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      );
    };

    age(); // window one: far beyond abandonMinutes, still CREATED
    expect((await service.expireAbandoned('admin', 'Bearer tok', 60)).cancelled).toBe(0);
    expect((await service.getAny(order.id)).status).toBe(OrderStatus.CREATED);

    await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'staff', undefined, 'Bearer tok');
    age(); // window two: far beyond stalledHours, now CONFIRMED
    expect((await service.expireAbandoned('admin', 'Bearer tok', 60)).cancelled).toBe(0);
    expect((await service.getAny(order.id)).status).toBe(OrderStatus.CONFIRMED);
    expect(inventory.releaseCalls).toHaveLength(0);
  });

  // A kill switch nobody has watched turn OFF is not a kill switch. `subscriptionSweepExempt`
  // set to 0 has to put the pre-D1 behaviour back exactly: the scheduled delivery ages out
  // like any other order and its stock comes back.
  it('sweeps a subscription delivery again when subscriptionSweepExempt is off (D1 kill switch)', async () => {
    jest.spyOn(config, 'subscriptionSweepExempt', 'get').mockReturnValue(false);
    const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    const order = await service.placeScheduled(
      customer,
      [{ productId: p.id, quantity: 1 }],
      address,
      'sub:s-2:2026-08-20T00:00:00.000Z',
      's-2',
    );
    orders.rows.find((r) => r.id === order.id)!.createdAt = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    );

    expect((await service.expireAbandoned('admin', 'Bearer tok', 60)).cancelled).toBe(1);
    expect((await service.getAny(order.id)).status).toBe(OrderStatus.CANCELLED);
    expect(inventory.releaseCalls).toHaveLength(1);
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

  // The express surcharge was a constant in the checkout SCREEN and had no counterpart
  // here at all: the customer read a total with Rp5.000 in it and the order stored one
  // without. These four are the money path.
  describe('express delivery', () => {
    it('adds the depot surcharge to the order, not just to the preview', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, { deliveryAddress: address, express: true });
      expect(order.deliveryFee).toBe(5000 + 5000); // per-galon shipping + express
      expect(order.total).toBe(20000 + 10000);
    });

    /**
     * The quote and the burn have to price the SAME fee. `quote` was passed `shippingFee`
     * on purpose — a FREE_SHIPPING voucher waives delivery, not a speed upgrade — while
     * `redeem` was passed `deliveryFee`, which includes the express surcharge. The order
     * therefore received a discount of the shipping fee while the promo ledger recorded the
     * larger number: a `budgetCap` burned down faster than the discounts it funded, and a
     * redeem that can throw VoucherBudgetExhausted on a quote that just passed.
     */
    it('burns a FREE_SHIPPING voucher against the same fee it was quoted on', async () => {
      await addToCart(20000, 1); // shipping 5000, express 5000 → deliveryFee 10000
      promo.quoteDiscount = 5000;
      promo.quoteDiscountType = 'FREE_SHIPPING';
      const order = await service.checkout(customer, {
        deliveryAddress: address,
        express: true,
        voucherCode: 'gratisongkir',
      });
      expect(order.discount).toBe(5000); // the shipping fee, express still charged
      expect(promo.quoteCalls[0].shippingFee).toBe(5000);
      expect(promo.redeemCalls[0].shippingFee).toBe(promo.quoteCalls[0].shippingFee);
    });

    it('charges nothing extra for a scheduled delivery', async () => {
      await addToCart(20000, 1);
      const order = await service.checkout(customer, {
        deliveryAddress: address,
        deliveryWindow: '09.00-11.00',
      });
      expect(order.deliveryFee).toBe(5000);
    });

    it('refuses express at a depot that has switched it off, rather than downgrading it', async () => {
      jest
        .spyOn(config, 'express')
        .mockReturnValue({ enabled: false, fee: 5000, etaMinMinutes: 30, etaMaxMinutes: 60 });
      await addToCart(20000, 1);
      await expect(
        service.checkout(customer, { deliveryAddress: address, express: true }),
      ).rejects.toThrow(ExpressUnavailableError);
    });

    it('reports what the screen may offer, from the same place checkout prices it', async () => {
      await expect(service.deliveryOptions(null)).resolves.toEqual({
        slots: ['09.00-11.00', '11.00-13.00'],
        expressEnabled: true,
        expressFee: 5000,
        expressEtaMinMinutes: 30,
        expressEtaMaxMinutes: 60,
      });
    });

    // Depot SOP §6: nobody is at the counter during the midday break, so the immediate
    // upgrade is off — while the scheduled slots stay, because tomorrow morning is fine.
    describe('while the depot is on its break or shut', () => {
      const shutDepot = {
        id: 'depot-near',
        lat: -6.9,
        lng: 107.6,
        serviceRadiusKm: 10,
        deliveryFee: 0,
        minOrderAmount: null,
        operatingHours: {
          mon: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
        },
        holidays: [],
      };
      const routed = { ...address, latitude: -6.91, longitude: 107.61 };
      // Monday 2026-08-10, 12.30 WIB — inside the break.
      const onBreak = new Date('2026-08-10T05:30:00.000Z');

      beforeEach(() => {
        depots.depots = [shutDepot];
        jest.useFakeTimers({ now: onBreak, doNotFake: ['nextTick', 'setImmediate'] });
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      it('withdraws express from the screen', async () => {
        const options = await service.deliveryOptions('depot-near');
        expect(options.expressEnabled).toBe(false);
        expect(options.slots).toHaveLength(2); // scheduled delivery is unaffected
      });

      it('refuses an express order rather than billing for it', async () => {
        await addToCart(20000, 1);
        await expect(
          service.checkout(customer, { deliveryAddress: routed, express: true }),
        ).rejects.toThrow(ExpressUnavailableError);
      });

      it('still accepts a scheduled order', async () => {
        await addToCart(20000, 1);
        const order = await service.checkout(customer, {
          deliveryAddress: routed,
          deliveryWindow: '09.00-11.00',
        });
        expect(order.deliveryWindow).toBe('09.00-11.00');
      });

      it('leaves express alone once the break is over', async () => {
        jest.setSystemTime(new Date('2026-08-10T06:30:00.000Z')); // 13.30 WIB
        await expect(service.deliveryOptions('depot-near')).resolves.toMatchObject({
          expressEnabled: true,
        });
      });

      // A directory blip must not quietly withdraw a paid upgrade the depot opted into.
      it('keeps express when the depot directory cannot answer', async () => {
        depots.unreachable = true;
        await expect(service.deliveryOptions('depot-near')).resolves.toMatchObject({
          expressEnabled: true,
        });
      });
    });
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
      customerDirectory,
      notification,
      promo,
      inventory,
      cartService,
      config,
      recommendation,
      forecast,
      franchiseRevenue,
      gallonIssue,
      new FakeCashierShift(),
      new FakePaymentReversal(),
      buildOutbox(orders),
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
  /*
   * An order priced from the CATALOG because the depot's own prices could not be read is a
   * money difference: the customer is billed at a number the depot did not set. It used to
   * leave no trace at all, so it surfaced weeks later at reconciliation with no way back to
   * the cause. Now it lands on the order's own timeline, where the person handling the
   * complaint can see it.
   */
  describe('catalog-price fallback leaves a trace', () => {
    it('notes on the order when the depot could not be priced', async () => {
      pricing.unavailable = true;
      const productId = await addToCart(20_000, 2);
      expect(productId).toBeDefined();

      const order = await service.checkout(customer, { deliveryAddress: address });

      const notes = orders.notes.filter((n) => n.id === order.id).map((n) => n.note);
      expect(notes.some((n) => n.includes('Harga dasar katalog'))).toBe(true);
      expect(notes.some((n) => n.includes('tidak terjangkau'))).toBe(true);
    });

    // A depot that priced normally leaves nothing behind — the note has to mean something.
    it('says nothing when the depot priced the order itself', async () => {
      await addToCart(20_000, 2);
      const order = await service.checkout(customer, { deliveryAddress: address });
      const notes = orders.notes.filter((n) => n.id === order.id).map((n) => n.note);
      expect(notes.some((n) => n.includes('Harga dasar katalog'))).toBe(false);
    });

    // Fail-open on the note itself: an order that is already placed and paid for must not
    // be unwound because the timeline write failed.
    it('does not unwind a placed order when the note cannot be written', async () => {
      pricing.unavailable = true;
      jest.spyOn(orders, 'appendNote').mockRejectedValue(new Error('db down'));
      await addToCart(20_000, 2);

      await expect(
        service.checkout(customer, { deliveryAddress: address }),
      ).resolves.toBeDefined();
    });
  });

  describe('assignDepot', () => {
    it('refuses an unknown order and an already-routed one', async () => {
      await expect(service.assignDepot(randomUUID(), 'depot-near')).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );
      await addToCart(20_000, 1);
      const routed = await service.checkout(customer, { deliveryAddress: address });
      await expect(service.assignDepot(routed.id, routed.depotId!)).rejects.toBeInstanceOf(
        OrderAlreadyRoutedError,
      );
    });
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

  async function build(withOwner: boolean, ownershipType?: 'WARALABA' | 'HKP') {
    const orders = new InMemoryOrderRepository();
    const cart = new InMemoryCartRepository();
    const catalog = new FakeProductCatalog();
    const depots = new FakeDepotDirectory();
    const revenue = new FakeFranchiseRevenue();
    depots.depots = [depot];
    if (withOwner) depots.owners.set(depot.id, 'owner-9');
    if (ownershipType) depots.ownershipTypes.set(depot.id, ownershipType);
    const cartService = buildCartService(cart, catalog);
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
      new FakeCustomerDirectory(),
      new FakeNotification(),
      new FakePromo(),
      new FakeInventory(),
      cartService,
      buildTestConfig(),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      revenue,
      new FakeGallonIssue(),
      new FakeCashierShift(),
      new FakePaymentReversal(),
      buildOutbox(orders),
    );
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await cartService.setItem('cust-rev', product.id, 3, false);
    const order = await service.checkout('cust-rev', { deliveryAddress: routedAddress });
    return { service, order, revenue, depots };
  }

  afterEach(() => jest.restoreAllMocks());

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

  it('posts nothing, and says nothing, for a company-owned depot', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, order, revenue } = await build(false, 'HKP');
    await complete(service, order.id);
    expect(revenue.posted).toHaveLength(0);
    expect(logged).not.toHaveBeenCalled();
  });

  it('logs the defect when a FRANCHISE depot has no owner, instead of dropping the revenue silently', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, order, revenue } = await build(false, 'WARALABA');
    await complete(service, order.id);
    expect(revenue.posted).toHaveLength(0);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(order.orderNumber));
  });

  it('posts nothing when the depot directory is unreachable at completion time', async () => {
    const { service, order, revenue, depots } = await build(true);
    depots.unreachable = true; // after checkout routed the order, so only the owner lookup fails
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
