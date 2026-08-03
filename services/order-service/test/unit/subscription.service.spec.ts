import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
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
  FakeCashierShift,
  FakePaymentReversal,
  FakeInventory,
  FakeLoyaltyCoordination,
  FakeMembership,
  FakeResellerDiscount,
  FakeNotification,
  FakeProductCatalog,
  FakePromo,
  FakeRecommendationCoordination,
  FakeReferralCoordination,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemorySubscriptionRepository,
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
  const customer = randomUUID();

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    subs = new InMemorySubscriptionRepository();
    catalog = new FakeProductCatalog();
    depots = new FakeDepotDirectory();
    depots.depots = [homeDepot];
    const cart = new InMemoryCartRepository();
    const cartService = new CartService(cart, catalog);
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
      new FakeNotification(),
      new FakePromo(),
      new FakeInventory(),
      cartService,
      buildTestConfig(),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      new FakeFranchiseRevenue(),
      new FakeCashierShift(),
      new FakePaymentReversal(),
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
    expect((await service.resume(customer, sub.id)).status).toBe('ACTIVE');
    expect((await service.cancel(customer, sub.id)).status).toBe('CANCELLED');
    await expect(service.pause(customer, sub.id)).rejects.toBeInstanceOf(
      SubscriptionNotActionableError,
    );
    // resume is equally blocked once cancelled (BR: a cancelled sub is terminal).
    await expect(service.resume(customer, sub.id)).rejects.toBeInstanceOf(
      SubscriptionNotActionableError,
    );
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
