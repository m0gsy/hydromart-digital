import { randomUUID } from 'node:crypto';

import { AuthenticatedUser } from '@hydromart/platform';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { ANONYMOUS_CUSTOMER_ID } from '../../src/domain/anonymous';
import {
  EmptyCartError,
  InsufficientStockError,
  InvalidStatusTransitionError,
} from '../../src/domain/errors';
import { OrderStatus } from '../../src/domain/order-status';
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

const DEPOT = '11111111-1111-4111-8111-111111111111';

describe('OrderService.walkInSale', () => {
  let orders: InMemoryOrderRepository;
  let catalog: FakeProductCatalog;
  let depots: FakeDepotDirectory;
  let loyalty: FakeLoyaltyCoordination;
  let referral: FakeReferralCoordination;
  let recommendation: FakeRecommendationCoordination;
  let forecast: FakeForecastCoordination;
  let franchiseRevenue: FakeFranchiseRevenue;
  let notification: FakeNotification;
  let inventory: FakeInventory;
  let service: OrderService;

  const operator: AuthenticatedUser = {
    sub: 'op-1',
    role: 'KEPALA_DEPOT' as never,
    phone: '08',
    depotId: DEPOT,
  };

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    const cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    depots = new FakeDepotDirectory();
    const pricing = new FakeDepotPricing();
    loyalty = new FakeLoyaltyCoordination();
    referral = new FakeReferralCoordination();
    recommendation = new FakeRecommendationCoordination();
    forecast = new FakeForecastCoordination();
    franchiseRevenue = new FakeFranchiseRevenue();
    notification = new FakeNotification();
    inventory = new FakeInventory();
    depots.owners.set(DEPOT, 'owner-1');
    service = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      pricing,
      loyalty,
      referral,
      new FakeMembership(),
      new FakeResellerDiscount(),
      notification,
      new FakePromo(),
      inventory,
      new CartService(cart, catalog),
      buildTestConfig(),
      recommendation,
      forecast,
      franchiseRevenue,
    );
  });

  const sell = async (quantity = 2, extra: Record<string, unknown> = {}) => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    return service.walkInSale(operator, {
      depotId: DEPOT,
      lines: [{ productId: product.id, quantity }],
      ...extra,
    });
  };

  // A counter sale is water leaving the depot exactly like a delivered order, so it
  // must carry the same volume snapshot — otherwise the day's meter reconciliation
  // reports every walk-in litre as unaccounted-for.
  it('snapshots the catalog volume and galon flag onto the counter-sale line', async () => {
    const product = catalog.seed({
      id: randomUUID(),
      basePrice: 20000,
      unit: 'Galon 19L',
      volumeMl: 19000,
      isGallon: true,
    });
    const order = await service.walkInSale(operator, {
      depotId: DEPOT,
      lines: [{ productId: product.id, quantity: 4 }],
    });
    expect(order.items[0]).toMatchObject({ volumeMl: 19000, isGallon: true, quantity: 4 });
  });

  it('completes the sale immediately with no delivery fee', async () => {
    const order = await sell(2);

    expect(order.status).toBe(OrderStatus.COMPLETED);
    expect(order.isWalkIn).toBe(true);
    expect(order.deliveryFee).toBe(0);
    expect(order.discount).toBe(0);
    expect(order.subtotal).toBe(40000);
    expect(order.total).toBe(40000);
    expect(order.depotId).toBe(DEPOT);
    // The seed history row records the status the order really opened at.
    expect(order.history[0].status).toBe(OrderStatus.COMPLETED);
  });

  it('fills the mandatory address snapshot with the counter', async () => {
    const order = await sell(1, { customerName: ' Budi ', customerPhone: ' 08123 ' });

    expect(order.recipientName).toBe('Budi');
    expect(order.phone).toBe('08123');
    expect(order.addressLine).toBe('Ambil langsung di depot');
  });

  it('falls back to a generic buyer when no name is given', async () => {
    const order = await sell(1);
    expect(order.recipientName).toBe('Pelanggan walk-in');
    expect(order.phone).toBe('-');
  });

  it('moves the stock: reserve then consume, keyed by the order id', async () => {
    const order = await sell(3);

    expect(inventory.reserveCalls).toHaveLength(1);
    expect(inventory.reserveCalls[0]).toMatchObject({ depotId: DEPOT, orderId: order.id });
    expect(inventory.calls).toHaveLength(1); // consume
    expect(inventory.calls[0].items[0].quantity).toBe(3);
  });

  it('records demand and franchise revenue even for an anonymous sale', async () => {
    const order = await sell(1);

    expect(forecast.calls.map((c) => c.orderId)).toContain(order.id);
    expect(recommendation.calls.map((c) => c.orderId)).toContain(order.id);
    expect(franchiseRevenue.posted[0]).toMatchObject({ orderId: order.id, amountIdr: order.total });
  });

  it('keeps an anonymous sale away from loyalty, referral and messaging', async () => {
    const order = await sell(1);

    // Loyalty mints an account for ANY uuid it is handed — the sentinel must never reach it.
    expect(order.customerId).toBe(ANONYMOUS_CUSTOMER_ID);
    expect(loyalty.calls).toHaveLength(0);
    expect(referral.calls).toHaveLength(0);
    expect(notification.calls).toHaveLength(0);
  });

  it('awards points and qualifies a referral once the buyer is identified', async () => {
    const customerId = randomUUID();
    const order = await sell(1, { customerId, customerPhone: '081234567890' });

    expect(order.customerId).toBe(customerId);
    expect(loyalty.calls[0]).toMatchObject({ customerId, orderId: order.id });
    expect(referral.calls[0]).toMatchObject({ customerId, orderId: order.id });
    expect(notification.calls.map((n) => n.event)).toContain('POINTS_EARNED');
  });

  it('never sends ORDER_RECEIVED — the goods already left with the buyer', async () => {
    await sell(1, { customerId: randomUUID(), customerPhone: '0812' });
    expect(notification.calls.map((n) => n.event)).not.toContain('ORDER_RECEIVED');
  });

  it('refuses a depot-locked operator selling for another depot', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    await expect(
      service.walkInSale(
        { ...operator, depotId: '22222222-2222-4222-8222-222222222222' },
        { depotId: DEPOT, lines: [{ productId: product.id, quantity: 1 }] },
      ),
    ).rejects.toThrow();
  });

  it('rejects an empty sale', async () => {
    await expect(service.walkInSale(operator, { depotId: DEPOT, lines: [] })).rejects.toBeInstanceOf(
      EmptyCartError,
    );
  });

  it('leaves no order behind when stock is short', async () => {
    inventory.reserveError = new InsufficientStockError();
    await expect(sell(5)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(orders.rows).toHaveLength(0);
  });

  it('still records the sale when the stock consume fails', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    inventory.consume = async () => {
      throw new Error('depot-service down');
    };
    // Reserve succeeded, so the units are still held and sellable stock stays honest.
    await expect(
      service.walkInSale(operator, { depotId: DEPOT, lines: [{ productId: product.id, quantity: 1 }] }),
    ).rejects.toThrow('depot-service down');
    expect(orders.rows).toHaveLength(1);
  });

  // The hold is placed before the row exists, so a create that throws used to leave the
  // depot short by that quantity with no order anywhere to ever release it.
  it('releases the stock hold when the order row cannot be written', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    orders.create = async () => {
      throw new Error('unique constraint');
    };
    await expect(
      service.walkInSale(operator, { depotId: DEPOT, lines: [{ productId: product.id, quantity: 2 }] }),
    ).rejects.toThrow('unique constraint');

    expect(inventory.releaseCalls).toHaveLength(1);
    expect(inventory.releaseCalls[0]).toMatchObject({
      depotId: DEPOT,
      orderId: inventory.reserveCalls[0].orderId,
    });
    expect(inventory.releaseCalls[0].items[0].quantity).toBe(2);
  });

  // The create error is what the cashier must see. A release that also fails on the way out
  // would otherwise replace it with a misleading depot-service message.
  it('surfaces the create error even when the compensating release fails', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    orders.create = async () => {
      throw new Error('unique constraint');
    };
    inventory.release = async () => {
      throw new Error('depot-service down');
    };
    await expect(
      service.walkInSale(operator, { depotId: DEPOT, lines: [{ productId: product.id, quantity: 1 }] }),
    ).rejects.toThrow('unique constraint');
  });

  it('cannot be advanced or re-completed afterwards', async () => {
    const order = await sell(1);
    await expect(
      service.updateStatus(order.id, OrderStatus.COMPLETED, 'op-1'),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });
});
