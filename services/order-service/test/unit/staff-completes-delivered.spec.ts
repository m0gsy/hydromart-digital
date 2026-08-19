import { randomUUID } from 'node:crypto';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import { OrderStatus } from '../../src/domain/order-status';
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
  buildCartService,
  buildOutbox,
  buildTestConfig,
} from '../support/fakes';

/*
 * B1 — an order stuck at DELIVERED must have a human way out.
 *
 * The only path from DELIVERED to COMPLETED is delivery-service's loop after proof of
 * delivery, which is fail-open and `break`s on the first failure. When the DELIVERED
 * advance lands and the COMPLETED one does not, the order sits there forever: no stock
 * consume, no loyalty points, no referral qualification, no franchise revenue — the four
 * effects that move money or stock.
 *
 * Measured on the running stack: order-service has always ACCEPTED the staff transition
 * (PATCH -> COMPLETED answered 200). Nothing offered it, because `staffCanAdvance` stopped
 * at CONFIRMED. So this is a trigger, not a new transition — and the effects behind it were
 * already made durable and idempotent by H-10, which is why retrying is safe.
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

const depot = {
  id: 'depot-home',
  lat: -6.9,
  lng: 107.6,
  serviceRadiusKm: 10,
  deliveryFee: 5000,
  minOrderAmount: null,
};

describe('staff can close an order stranded at DELIVERED (B1)', () => {
  let orders: InMemoryOrderRepository;
  let catalog: FakeProductCatalog;
  let inventory: FakeInventory;
  let cartService: CartService;
  let service: OrderService;
  const customer = randomUUID();

  const build = (overrides: Record<string, string> = {}): void => {
    orders = new InMemoryOrderRepository();
    const cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    const depots = new FakeDepotDirectory();
    depots.depots = [depot];
    inventory = new FakeInventory();
    cartService = buildCartService(cart, catalog);
    service = new OrderService(
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
      inventory,
      cartService,
      buildTestConfig(overrides),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      new FakeFranchiseRevenue(),
      new FakeCashierShift(),
      new FakePaymentReversal(),
      buildOutbox(orders),
    );
  };

  beforeEach(() => build());

  /** An order the courier handed over, whose COMPLETED advance never landed. */
  const strandedAtDelivered = async (): Promise<string> => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await cartService.setItem(customer, product.id, 2, false);
    const order = await service.checkout(customer, { deliveryAddress: address });
    for (const status of [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
    ]) {
      await service.updateStatus(order.id, status, 'staff-1');
    }
    return order.id;
  };

  it('offers the action on the staff queue for a stranded order', async () => {
    const id = await strandedAtDelivered();

    const page = await service.listAll({ page: 1, limit: 20 });
    const row = page.items.find((o) => o.id === id);

    expect(row?.status).toBe(OrderStatus.DELIVERED);
    expect(row?.staffCanComplete).toBe(true);
  });

  it('offers nothing on an order that is not stranded', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await cartService.setItem(customer, product.id, 1, false);
    const order = await service.checkout(customer, { deliveryAddress: address });

    const page = await service.listAll({ page: 1, limit: 20 });

    expect(page.items.find((o) => o.id === order.id)?.staffCanComplete).toBe(false);
  });

  it('the action actually completes the order and settles what it owed', async () => {
    const id = await strandedAtDelivered();
    expect(inventory.calls).toHaveLength(0);

    const done = await service.updateStatus(id, OrderStatus.COMPLETED, 'staff-1');

    expect(done.status).toBe(OrderStatus.COMPLETED);
    // The four effects were owed durably from the transition itself (H-10), so closing it
    // by hand settles them — this is the whole point of giving staff the trigger.
    expect(inventory.calls).toHaveLength(1);
  });

  /*
   * The kill switch. Off means the button disappears and NOTHING else changes:
   * delivery-service keeps advancing orders exactly as it does today, which is the
   * behaviour this reverts to.
   */
  it('hides the action when staffCompleteDelivered is off, without blocking the old path', async () => {
    build({ ORDER_STAFF_COMPLETE_DELIVERED: '0' });
    const id = await strandedAtDelivered();

    const page = await service.listAll({ page: 1, limit: 20 });
    expect(page.items.find((o) => o.id === id)?.staffCanComplete).toBe(false);

    // delivery-service's own advance goes through the same method and is untouched.
    const done = await service.updateStatus(id, OrderStatus.COMPLETED, 'delivery-service');
    expect(done.status).toBe(OrderStatus.COMPLETED);
    expect(inventory.calls).toHaveLength(1);
  });
});
