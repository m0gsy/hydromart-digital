import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { SubscriptionService } from '../../src/application/services/subscription.service';
import {
  ProductUnavailableError,
  SubscriptionNotFoundError,
} from '../../src/domain/errors';
import { SubscriptionNotActionableError } from '../../src/domain/errors';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import {
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeForecastCoordination,
  FakeInventory,
  FakeLoyaltyCoordination,
  FakeMembership,
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

describe('SubscriptionService', () => {
  let orders: InMemoryOrderRepository;
  let subs: InMemorySubscriptionRepository;
  let catalog: FakeProductCatalog;
  let orderService: OrderService;
  let service: SubscriptionService;
  const customer = randomUUID();

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    subs = new InMemorySubscriptionRepository();
    catalog = new FakeProductCatalog();
    const cart = new InMemoryCartRepository();
    const cartService = new CartService(cart, catalog);
    orderService = new OrderService(
      orders,
      cart,
      catalog,
      new FakeDepotDirectory(),
      new FakeDepotPricing(),
      new FakeLoyaltyCoordination(),
      new FakeReferralCoordination(),
      new FakeMembership(),
      new FakeNotification(),
      new FakePromo(),
      new FakeInventory(),
      cartService,
      buildTestConfig(),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
    );
    service = new SubscriptionService(subs, catalog, orderService);
  });

  const seedProduct = () => catalog.seed({ id: randomUUID(), basePrice: 8000 });

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
    await expect(service.pause(customer, sub.id)).rejects.toBeInstanceOf(SubscriptionNotActionableError);
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
    // spec 7b: 5% subscription discount applied. subtotal = 8000 × 3 = 24000 → 1200 off.
    expect(orders.rows[0].discount).toBe(1200);
    // schedule advanced one week past `now`.
    const advanced = (await service.list(customer))[0].nextDeliveryAt;
    expect(advanced.getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    // a paused subscription is not swept.
    await service.pause(customer, sub.id);
    expect((await service.processDue(new Date('2026-08-01T00:00:00Z'))).placed).toBe(0);
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
    await expect(service.pause(randomUUID(), sub.id)).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    await expect(service.cancel(customer, randomUUID())).rejects.toBeInstanceOf(SubscriptionNotFoundError);
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
});
