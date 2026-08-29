import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { OrderStatus } from '../../src/domain/order-status';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  FakeCashierShift,
  FakeCustomerDirectory,
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeForecastCoordination,
  FakeFranchiseRevenue,
  FakeGallonIssue,
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
  buildCartService,
  buildOutbox,
  buildTestConfig,
} from '../support/fakes';

const address: DeliveryAddressSnapshot = {
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bekasi',
  province: 'Jawa Barat',
  postalCode: '17111',
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

/**
 * W2 — the auto-cancellation nobody heard.
 *
 * Both Bekasi depots trade 08.00–21.00 and payment is cash at the door, so a CASH order
 * is never PAID by a gateway: CREATED→CONFIRMED needs a human at the counter. An order
 * placed at 22.00 therefore sits in CREATED all night, and `scripts/scheduler/crontab`
 * runs `expire-abandoned` every hour. Sixty minutes later the order was cancelled and its
 * stock released, and the customer was told nothing at all — while the very same
 * cancellation done by a staff member sent ORDER_CANCELLED.
 *
 * Asserted on all three roads to a status write, because the defect was that they
 * disagreed, not that one of them was wrong.
 */
describe('a status change the customer did not make reaches the customer (W2)', () => {
  let orders: InMemoryOrderRepository;
  let catalog: FakeProductCatalog;
  let notification: FakeNotification;
  let inventory: FakeInventory;
  let cartService: CartService;
  let service: OrderService;
  const customer = randomUUID();

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    const cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    const depots = new FakeDepotDirectory();
    depots.depots = [homeDepot];
    const pricing = new FakeDepotPricing();
    const resellerDiscount = new FakeResellerDiscount();
    const config = buildTestConfig();
    notification = new FakeNotification();
    inventory = new FakeInventory();
    cartService = buildCartService(cart, catalog, pricing, resellerDiscount, config);
    service = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      pricing,
      new FakeLoyaltyCoordination(),
      new FakeReferralCoordination(),
      new FakeMembership(),
      resellerDiscount,
      new FakeCustomerDirectory(),
      notification,
      new FakePromo(),
      inventory,
      cartService,
      config,
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      new FakeFranchiseRevenue(),
      new FakeGallonIssue(),
      new FakeCashierShift(),
      new FakePaymentReversal(),
      buildOutbox(orders),
    );
  });

  /** A live CREATED order, placed the way the night-time cash orders in the report were. */
  const place = async (): Promise<{ id: string; orderNumber: string }> => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    const order = await service.placeScheduled(
      customer,
      [{ productId: product.id, quantity: 2 }],
      address,
    );
    return { id: order.id, orderNumber: order.orderNumber };
  };

  /** Backdates the order so the sweep sees it. The fake filters on `createdAt`. */
  const age = (id: string, ms: number): void => {
    orders.rows.find((r) => r.id === id)!.createdAt = new Date(Date.now() - ms);
  };

  const cancellations = (): { phone: string; vars: Record<string, string> }[] =>
    notification.calls.filter((c) => c.event === 'ORDER_CANCELLED');

  it('tells the customer when the abandoned sweep cancels their order', async () => {
    const order = await place();
    age(order.id, 90 * 60_000);

    expect((await service.expireAbandoned('system:scheduler', 'Bearer tok', 60)).cancelled).toBe(1);

    expect(cancellations()).toHaveLength(1);
    expect(cancellations()[0].phone).toBe(address.phone);
    expect(cancellations()[0].vars.orderNumber).toBe(order.orderNumber);
  });

  it('tells the customer when the stalled-at-the-depot sweep cancels their order', async () => {
    const order = await place();
    await service.updateStatus(order.id, OrderStatus.CONFIRMED, 'staff-1', undefined, 'Bearer tok');
    age(order.id, 48 * 3_600_000); // window is 24h

    expect((await service.expireAbandoned('system:scheduler', 'Bearer tok', 60)).cancelled).toBe(1);

    expect(cancellations()).toHaveLength(1);
  });

  it('still tells the customer when staff cancel by hand', async () => {
    const order = await place();
    await service.updateStatus(order.id, OrderStatus.CANCELLED, 'staff-1', 'stok habis', 'Bearer t');
    expect(cancellations()).toHaveLength(1);
  });

  // The one road that stays silent, and the reason is the actor: the customer is looking at
  // the screen that just confirmed it. Same call the VOIDED case makes in order-status.ts —
  // a WhatsApp minutes later about something you just did yourself is noise, not news.
  it('stays quiet when the customer cancels their own order', async () => {
    const order = await place();
    await service.cancel(customer, order.id, 'ganti hari', 'Bearer tok');
    expect(cancellations()).toHaveLength(0);
    expect((await service.getAny(order.id)).status).toBe(OrderStatus.CANCELLED);
  });

  // The message is a side effect of a committed transition, never a condition of it: the
  // stock still comes back and the sweep still counts the order (the port fails open by
  // contract, but the ORDER matters more than the proof of that here).
  it('releases the stock as well as speaking', async () => {
    const order = await place();
    age(order.id, 90 * 60_000);
    await service.expireAbandoned('system:scheduler', 'Bearer tok', 60);
    expect(inventory.releaseCalls).toHaveLength(1);
    expect(inventory.releaseCalls[0]).toMatchObject({ orderId: order.id });
  });
});

/**
 * W2b — the sweep swallowed orders that were never abandoned.
 *
 * `findStaleIn` asked one question: has this order sat in its status longer than the
 * window. An order the customer deliberately booked for a later day answers "yes" sixty
 * minutes after checkout, and was auto-cancelled while the depot was still shut — the
 * exact orders the schedule exists for.
 *
 * Asserted on the predicate, not on a row: the query had no way to tell a deferred order
 * from an abandoned one, so no fixture could have caught it.
 */
describe('the abandoned sweep leaves a scheduled order alone (W2b)', () => {
  const order = { findMany: jest.fn() };
  const repo = new OrderPrismaRepository({ order } as unknown as PrismaService);
  const before = new Date('2026-01-05T00:00:00.000Z');
  /** `before` minus the four-day checkout horizon — see SCHEDULED_GRACE_MS. */
  const graced = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    order.findMany.mockResolvedValue([]);
  });

  const whereOf = async (): Promise<Record<string, unknown>> => {
    await repo.findStaleIn([OrderStatus.CREATED], before);
    return order.findMany.mock.calls.at(-1)![0].where;
  };

  it('exempts an order carrying a customer-chosen delivery window', async () => {
    expect((await whereOf()).OR).toEqual([
      { deliveryWindow: null },
      { deliveryWindow: { in: ['', 'Antar sekarang (express)'] } },
      { statusChangedAt: { lt: graced } },
    ]);
  });

  // "Antar sekarang" is a request for NOW, not a schedule. It is stored in the same column
  // as the slot labels, so it has to be named or express orders would inherit the grace and
  // hold their reservation for days.
  it('gives no grace to an express order, which asked for now', async () => {
    const or = (await whereOf()).OR as { deliveryWindow?: { in: string[] } }[];
    expect(or[1].deliveryWindow!.in).toContain('Antar sekarang (express)');
  });

  // The exemption is a grace, not an amnesty: a scheduled order that outlives the furthest
  // slot checkout can sell is abandoned like any other, and its stock has to come back.
  it('sweeps a scheduled order once it is stale past the booking horizon', async () => {
    const where = await whereOf();
    expect((where.OR as { statusChangedAt?: { lt: Date } }[])[2].statusChangedAt!.lt).toEqual(
      graced,
    );
    // The base cutoff is still ANDed on top — the grace lengthens the window, it does not
    // replace it, so nothing fresher than `before` is ever a candidate.
    expect(where.statusChangedAt).toEqual({ lt: before });
  });

  it('keeps the D1 subscription exclusion and its kill switch', async () => {
    expect((await whereOf()).subscriptionId).toBeNull();
    await repo.findStaleIn([OrderStatus.CREATED], before, undefined, false);
    expect(order.findMany.mock.calls.at(-1)![0].where).not.toHaveProperty('subscriptionId');
  });
});
