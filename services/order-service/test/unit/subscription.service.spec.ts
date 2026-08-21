import { randomUUID } from 'node:crypto';

import { OrderService } from '../../src/application/services/order.service';
import { SubscriptionService } from '../../src/application/services/subscription.service';
import { ProductUnavailableError, SubscriptionNotFoundError } from '../../src/domain/errors';
import { SubscriptionNotActionableError } from '../../src/domain/errors';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import {
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeForecastCoordination,
  FakeFranchiseRevenue,
  FakeGallonIssue,
  FakeCashierShift,
  FakePaymentReversal,
  FakeInventory,
  FakeLoyaltyCoordination,
  FakeMembership,
  FakeResellerDiscount,
  FakeCustomerDirectory,
  FakeNotification,
  FakeProductCatalog,
  FakePromo,
  FakeRecommendationCoordination,
  FakeReferralCoordination,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemorySubscriptionRepository,
  buildCartService,
  buildOutbox,
  buildTestConfig,
} from '../support/fakes';

// Pinned: a scheduled run has nobody to ask for a depot, so an unpinned saved
// address is skipped by design (see 'skips a subscription that cannot be routed').
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

describe('SubscriptionService', () => {
  let orders: InMemoryOrderRepository;
  let subs: InMemorySubscriptionRepository;
  let catalog: FakeProductCatalog;
  let orderService: OrderService;
  let service: SubscriptionService;
  let depots: FakeDepotDirectory;
  // D9: the scheduled-order notification is sent AFTER the row exists and fails open, so
  // the spec needs a handle on it to make a send fail.
  let notification: FakeNotification;
  const customer = randomUUID();

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    subs = new InMemorySubscriptionRepository();
    catalog = new FakeProductCatalog();
    depots = new FakeDepotDirectory();
    depots.depots = [homeDepot];
    const cart = new InMemoryCartRepository();
    const cartService = buildCartService(cart, catalog);
    notification = new FakeNotification();
    orderService = new OrderService(
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
      notification,
      new FakePromo(),
      new FakeInventory(),
      cartService,
      buildTestConfig(),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      new FakeFranchiseRevenue(),
      new FakeGallonIssue(),
      new FakeCashierShift(),
      new FakePaymentReversal(),
      buildOutbox(orders),
    );
    service = new SubscriptionService(subs, catalog, orderService, buildTestConfig());
  });

  const seedProduct = () => catalog.seed({ id: randomUUID(), basePrice: 8000 });

  it('discountRate: quotes the depot ladder the sweep will actually charge', () => {
    // Same config the sweep prices against — the shop cannot quote a different saving.
    expect(service.discountRate(homeDepot.id)).toBe(0.05);
    expect(service.discountRate(null)).toBe(0.05);
  });

  it('creates an ACTIVE subscription snapshotting product name/unit', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 2,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
      address,
    });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.productName).toBe(p.name);
    expect(sub.quantity).toBe(2);
  });

  it('pauses, resumes and cancels; a cancelled sub can no longer be changed', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'MONTHLY',
      firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
      address,
    });
    expect((await service.pause(customer, sub.id)).status).toBe('PAUSED');
    expect((await service.resume(customer, sub.id, new Date())).status).toBe('ACTIVE');
    expect((await service.cancel(customer, sub.id)).status).toBe('CANCELLED');
    await expect(service.pause(customer, sub.id)).rejects.toBeInstanceOf(
      SubscriptionNotActionableError,
    );
    // resume is equally blocked once cancelled (BR: a cancelled sub is terminal).
    await expect(service.resume(customer, sub.id, new Date())).rejects.toBeInstanceOf(
      SubscriptionNotActionableError,
    );
  });

  // L0 REPRO (D4): pause never touches nextDeliveryAt, so the plan keeps its old due date
  // while it is asleep. Resume after six weeks and the very next sweep places a delivery
  // immediately — the customer paused their water and gets a gallon on the doorstep the
  // moment they come back.
  it('D4 REPRO: resuming after six weeks delivers immediately', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    await service.pause(customer, sub.id);

    const sixWeeksLater = new Date('2026-08-12T00:00:00Z');
    await service.resume(customer, sub.id, sixWeeksLater);

    // The next delivery must be in the FUTURE, not six weeks in the past.
    expect((await service.processDue(sixWeeksLater)).placed).toBe(0);
  });

  // The delivery DAY has to survive the pause too. Stepping the plan's own cadence keeps a
  // Tuesday plan on Tuesdays; adding one interval to the resume moment would move every
  // paused plan to whatever weekday the customer happened to press the button.
  it('keeps the delivery weekday across a pause (D4)', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-07T00:00:00Z'), // a Tuesday
      address,
    });
    await service.pause(customer, sub.id);

    // Resumed on a Thursday, six weeks on.
    const resumed = await service.resume(customer, sub.id, new Date('2026-08-13T09:00:00Z'));
    expect(resumed.nextDeliveryAt.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(resumed.nextDeliveryAt.getUTCDay()).toBe(2); // still Tuesday
  });

  // Resuming a plan that was never overdue must not push its date out — pausing for an
  // afternoon should not cost the customer a delivery.
  it('leaves a not-yet-due plan alone on resume (D4)', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-08-20T00:00:00Z'),
      address,
    });
    await service.pause(customer, sub.id);
    const resumed = await service.resume(customer, sub.id, new Date('2026-08-14T00:00:00Z'));
    expect(resumed.nextDeliveryAt.toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });

  /**
   * D6 · the sweep is the only caller that knows which subscription a delivery belongs to,
   * so it is the only place the link can be recorded. Asserted on the stored row rather
   * than on the call, because a column nothing writes is the same as no column.
   *
   * The link existed before only as the idempotency string `sub:<id>:<iso>` — exposed on no
   * read model, queryable by nobody, and a naming convention D1 would otherwise have to
   * rest a money predicate on.
   */
  it('D6 · stamps the placed order with the subscription that produced it', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });

    await service.processDue(new Date('2026-07-13T00:00:00Z'));

    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0].subscriptionId).toBe(sub.id);
  });

  // L0 REPRO (D9): the ORDER_RECEIVED for a scheduled delivery is sent AFTER the order row
  // exists, and the notification port fails open — so a send that never lands leaves the
  // order placed, the customer uninformed, and nothing on the order saying so. The only
  // trace is a warning in a container log nobody reads.
  it('D9 REPRO: a scheduled order records nothing when the customer was never told', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    // How the real adapter reports an outage: it fails OPEN and answers `false`. Throwing
    // here would simulate an adapter that does not exist, and would test the sweep's
    // isolation instead of the silence this is about.
    notification.notify = async () => false;

    const out = await service.processDue(new Date('2026-07-02T00:00:00Z'));
    expect(out.placed).toBe(1);

    const placed = orders.rows[0]!;
    expect(orders.notes).toContainEqual(
      expect.objectContaining({
        id: placed.id,
        changedBy: 'order-service',
        note: expect.stringMatching(/tidak diberi tahu/i),
      }),
    );
  });

  // The other half, or "record the silence" becomes "record everything": a delivery whose
  // message DID land must carry no such note, or the note stops meaning anything.
  it('leaves no not-notified note when the message landed (D9)', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });

    expect((await service.processDue(new Date('2026-07-02T00:00:00Z'))).placed).toBe(1);
    expect(notification.calls.map((c) => c.event)).toContain('ORDER_RECEIVED');
    expect(orders.notes).toHaveLength(0);
  });

  it('processDue places an order for a due subscription and advances its schedule', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'), // already past
      address,
    });

    const now = new Date('2026-07-13T00:00:00Z');
    const result = await service.processDue(now);

    expect(result.placed).toBe(1);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0].customerId).toBe(customer);
    // spec 7b: the routed depot's subscription discount applied (5% by default here).
    // subtotal = 8000 × 3 = 24000 → 1200 off.
    expect(orders.rows[0].discount).toBe(1200);
    // schedule advanced one week past `now`.
    const advanced = (await service.list(customer))[0].nextDeliveryAt;
    expect(advanced.getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    // a paused subscription is not swept.
    await service.pause(customer, sub.id);
    expect((await service.processDue(new Date('2026-08-01T00:00:00Z'))).placed).toBe(0);
  });

  // H-3. The sweep read due rows, placed an order, then advanced the schedule. Two
  // sweeps overlapping — or an ops trigger fired twice — both saw the same row as due
  // and each placed a delivery the customer never ordered.
  it('places one delivery when two sweeps run over the same due subscription', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });

    const now = new Date('2026-07-13T00:00:00Z');
    const [a, b] = await Promise.all([service.processDue(now), service.processDue(now)]);

    expect(orders.rows).toHaveLength(1);
    // Counted by whoever moved the schedule on, so the ops report says one, not two.
    expect(a.placed + b.placed).toBe(1);
  });

  it('skips a subscription whose address cannot be routed, leaving its schedule alone', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address: { ...address, latitude: null, longitude: null },
    });

    const result = await service.processDue(new Date('2026-07-13T00:00:00Z'));

    // Placing a depot-less order would lose it silently; skipping keeps it due.
    expect(result.placed).toBe(0);
    expect(orders.rows).toHaveLength(0);
    const stillDue = (await service.list(customer)).find((s) => s.id === sub.id)!;
    expect(stillDue.nextDeliveryAt.getTime()).toBe(new Date('2026-07-01T00:00:00Z').getTime());
  });

  it('refuses to subscribe to an inactive/unknown product', async () => {
    const inactive = catalog.seed({ id: randomUUID(), basePrice: 8000, active: false });
    await expect(
      service.create(customer, {
        productId: inactive.id,
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
        address,
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);
    await expect(
      service.create(customer, {
        productId: randomUUID(),
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
        address,
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);
  });

  it('404s when acting on a subscription the caller does not own', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'MONTHLY',
      firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
      address,
    });
    await expect(service.pause(randomUUID(), sub.id)).rejects.toBeInstanceOf(
      SubscriptionNotFoundError,
    );
    await expect(service.cancel(customer, randomUUID())).rejects.toBeInstanceOf(
      SubscriptionNotFoundError,
    );
  });

  it('estimates monthly network delivery volume by cadence (18c)', async () => {
    const p = seedProduct();
    const mk = (frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY') =>
      service.create(customer, {
        productId: p.id,
        quantity: 1,
        frequency,
        firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
        address,
      });
    await mk('WEEKLY'); // 30/7 ≈ 4.286 deliveries/mo
    await mk('BIWEEKLY'); // 30/14 ≈ 2.143
    await mk('MONTHLY'); // 1

    const summary = await service.networkSummary();
    expect(summary.activeSubscriptions).toBe(3);
    expect(summary.activeSubscribers).toBe(1); // all one customer
    // rounded sum: 4.286 + 2.143 + 1 = 7.43 → 7
    expect(summary.estMonthlyDeliveries).toBe(7);
  });

  it('processDue isolates failures: a placement error skips that sub without advancing it', async () => {
    // Product exists at subscribe time but is later pulled → placeScheduled throws inside the sweep.
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    catalog.throwOnGet = true; // pricing lookup now fails for this product

    const before = (await service.list(customer))[0].nextDeliveryAt.getTime();
    const result = await service.processDue(new Date('2026-07-13T00:00:00Z'));

    expect(result.placed).toBe(0);
    expect(orders.rows).toHaveLength(0);
    // schedule NOT advanced — the sub stays due for the next sweep.
    expect((await service.list(customer))[0].nextDeliveryAt.getTime()).toBe(before);
    expect(sub.status).toBe('ACTIVE');
  });

  it('logs a non-Error rejection without stopping the sweep', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    jest.spyOn(orders, 'create').mockRejectedValue('depot-service unreachable');

    await expect(service.processDue(new Date('2026-07-13T00:00:00Z'))).resolves.toEqual({
      placed: 0,
    });
  });
});
