import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { SubscriptionService } from '../../src/application/services/subscription.service';
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
});
