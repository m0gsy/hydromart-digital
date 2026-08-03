import { randomUUID } from 'node:crypto';

import { AuthenticatedUser } from '@hydromart/platform';

import { CartService } from '../../src/application/services/cart.service';
import { OrderService } from '../../src/application/services/order.service';
import { ANONYMOUS_CUSTOMER_ID } from '../../src/domain/anonymous';
import {
  AnonymousVoucherNotAllowedError,
  EmptyCartError,
  InsufficientStockError,
  InvalidStatusTransitionError,
  NoOpenShiftError,
  NotACounterSaleError,
  OrderAlreadyVoidedError,
  PaymentReversalFailedError,
  ShippingVoucherAtCounterError,
  VoidWindowClosedError,
  VoucherRejectedError,
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
  FakeCashierShift,
  FakePaymentReversal,
  FakeMembership,
  FakeResellerDiscount,
  FakeNotification,
  FakePromo,
  FakeInventory,
  FakeProductCatalog,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  buildOutbox,
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
  let membership: FakeMembership;
  let promo: FakePromo;
  let shift: FakeCashierShift;
  let paymentReversal: FakePaymentReversal;
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
    membership = new FakeMembership();
    promo = new FakePromo();
    shift = new FakeCashierShift();
    paymentReversal = new FakePaymentReversal();
    depots.owners.set(DEPOT, 'owner-1');
    service = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      pricing,
      loyalty,
      referral,
      membership,
      new FakeResellerDiscount(),
      notification,
      promo,
      inventory,
      new CartService(cart, catalog),
      buildTestConfig(),
      recommendation,
      forecast,
      franchiseRevenue,
      shift,
      paymentReversal,
      buildOutbox(orders),
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

  // B-13 at the till. A cashier on a flaky depot connection taps Bayar again; the goods
  // only left the counter once, and the drawer has to agree.
  it('returns the same sale when the till retries with the same Idempotency-Key', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    const sale = { depotId: DEPOT, lines: [{ productId: product.id, quantity: 2 }] };

    const first = await service.walkInSale(operator, { ...sale, idempotencyKey: 'till-1' });
    const retry = await service.walkInSale(operator, { ...sale, idempotencyKey: 'till-1' });

    expect(retry.id).toBe(first.id);
    expect(orders.rows).toHaveLength(1);
    // The completion fan-out must not run twice either — that is the stock consume.
    expect(inventory.calls).toHaveLength(1);
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

  // H-10 changed this contract for the better. A failed consume used to escape and 500
  // the till on a sale that HAD been recorded; now the sale stands and the consume stays
  // owed in the outbox, where the sweep picks it up when depot-service is back.
  it('records the sale and keeps owing the consume when depot-service is down', async () => {
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    inventory.consume = async () => {
      throw new Error('depot-service down');
    };
    // Reserve succeeded, so the units are still held and sellable stock stays honest.
    const sale = await service.walkInSale(operator, {
      depotId: DEPOT,
      lines: [{ productId: product.id, quantity: 1 }],
    });

    expect(orders.rows).toHaveLength(1);
    const owed = orders.outbox!.rows.find((r) => r.topic === 'INVENTORY_CONSUME')!;
    expect(owed).toMatchObject({ orderId: sale.id, status: 'PENDING', attempts: 1 });
    expect(owed.lastError).toBe('depot-service down');
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

  // Cash entering a drawer nobody has claimed is how a shortfall ends up with no owner.
  describe('the open-shift gate', () => {
    it('refuses the sale when the cashier has no shift open', async () => {
      shift.open = false;
      await expect(sell(1)).rejects.toBeInstanceOf(NoOpenShiftError);
    });

    // Refused BEFORE anything is priced or held, or a rejected sale would leave the depot
    // short by that quantity until the hold expired.
    it('holds no stock and writes no order when the gate refuses', async () => {
      shift.open = false;
      await expect(sell(2)).rejects.toBeInstanceOf(NoOpenShiftError);
      expect(inventory.reserveCalls).toHaveLength(0);
      expect(orders.rows).toHaveLength(0);
    });

    it('asks depot-service about this depot, carrying the caller token', async () => {
      await service.walkInSale(
        operator,
        { depotId: DEPOT, lines: [{ productId: catalog.seed({ id: randomUUID(), basePrice: 20000 }).id, quantity: 1 }] },
        'Bearer cashier-token',
      );
      expect(shift.calls[0]).toEqual({ depotId: DEPOT, authorization: 'Bearer cashier-token' });
    });
  });

  describe('discounts at the counter', () => {
    // The call carries the CASHIER's token. Reading the tier by token would hand every buyer
    // whatever discount the person behind the counter happens to have.
    it('prices the tier against the buyer, never the cashier', async () => {
      membership.rate = 0.1;
      const customerId = randomUUID();
      const order = await sell(2, { customerId, customerPhone: '0812' });

      expect(membership.byCustomerCalls[0]).toEqual({ customerId, depotId: DEPOT });
      expect(membership.calls).toHaveLength(0);
      expect(order.discount).toBe(4000);
      expect(order.total).toBe(36000);
    });

    it('applies a voucher from the buyer wallet and records the redemption', async () => {
      promo.quoteDiscount = 5000;
      const customerId = randomUUID();
      const order = await sell(2, { customerId, customerPhone: '0812', voucherCode: ' hemat10 ' });

      expect(promo.quoteForCalls[0]).toMatchObject({ code: 'HEMAT10', customerId, subtotal: 40000 });
      expect(order.discount).toBe(5000);
      expect(order.total).toBe(35000);
      expect(promo.redeemCalls[0]).toMatchObject({ code: 'HEMAT10', orderId: order.id });
    });

    it('stacks the tier and the voucher, capped at the goods', async () => {
      membership.rate = 0.5;
      promo.quoteDiscount = 30000;
      const order = await sell(2, { customerId: randomUUID(), customerPhone: '0812', voucherCode: 'BIG' });

      expect(order.discount).toBe(40000);
      expect(order.total).toBe(0);
    });

    // Fail CLOSED: a voucher the buyer handed over must be honoured or the sale must stop.
    it('rejects the sale when the voucher cannot be validated', async () => {
      promo.rejectQuote = true;
      await expect(
        sell(1, { customerId: randomUUID(), customerPhone: '0812', voucherCode: 'NOPE' }),
      ).rejects.toBeInstanceOf(VoucherRejectedError);
      expect(orders.rows).toHaveLength(0);
    });

    it('refuses a voucher on an anonymous sale — there is no wallet to spend from', async () => {
      await expect(sell(1, { voucherCode: 'HEMAT10' })).rejects.toBeInstanceOf(
        AnonymousVoucherNotAllowedError,
      );
      expect(promo.quoteForCalls).toHaveLength(0);
    });

    it('refuses a free-shipping voucher rather than burn it on a sale with no delivery', async () => {
      promo.quoteDiscount = 8000;
      promo.quoteDiscountType = 'FREE_SHIPPING';
      await expect(
        sell(1, { customerId: randomUUID(), customerPhone: '0812', voucherCode: 'GRATISONGKIR' }),
      ).rejects.toBeInstanceOf(ShippingVoucherAtCounterError);
      expect(orders.rows).toHaveLength(0);
    });

    it('leaves an anonymous sale at full price and asks loyalty nothing', async () => {
      membership.rate = 0.2;
      const order = await sell(1);

      expect(membership.byCustomerCalls).toHaveLength(0);
      expect(order.discount).toBe(0);
      expect(order.total).toBe(order.subtotal);
    });
  });

  describe('voiding a counter sale', () => {
    const NOW = new Date('2026-08-03T04:00:00Z'); // 11:00 Jakarta

    // The sale is created with the fake repo's own clock, so the test pins "today" to it.
    const soldToday = async (extra: Record<string, unknown> = {}) => {
      const order = await sell(2, extra);
      return { order, now: new Date(order.createdAt.getTime() + 60 * 60 * 1000) };
    };

    it('reverses the sale, puts the stock back and takes the points away', async () => {
      const customerId = randomUUID();
      const { order, now } = await soldToday({ customerId, customerPhone: '0812' });

      const voided = await service.voidCounterSale(operator, order.id, 'Salah ukuran', now, 'Bearer t');

      expect(voided.status).toBe(OrderStatus.VOIDED);
      expect(inventory.restockCalls[0]).toMatchObject({ depotId: DEPOT, orderId: order.id });
      expect(inventory.restockCalls[0].items[0].quantity).toBe(2);
      expect(paymentReversal.calls[0]).toEqual({ orderId: order.id, reason: 'Salah ukuran' });
      // The owner's ledger is a separate book: excluding the order from reports does not
      // touch it, so it has to be backed out explicitly.
      expect(franchiseRevenue.voided[0]).toEqual({ orderId: order.id, reason: 'Salah ukuran' });
      expect(loyalty.reversals[0]).toMatchObject({ customerId, orderId: order.id });
      // The reason is the till's own account of a drawer that will now be short.
      expect(voided.history.at(-1)).toMatchObject({ status: OrderStatus.VOIDED, note: 'Salah ukuran' });
    });

    it('asks loyalty nothing for an anonymous sale — it never earned anything', async () => {
      const { order, now } = await soldToday();
      await service.voidCounterSale(operator, order.id, 'Batal', now);
      expect(loyalty.reversals).toHaveLength(0);
      expect(inventory.restockCalls).toHaveLength(1);
    });

    // Everything after the status write is fail-open: the buyer already has the goods and
    // the money back, so a depot-service blip must not leave the sale standing as revenue.
    // Reporting "gagal membatalkan" once the money is back and the order reversed would be
    // a lie the cashier acts on — they would try again, or hand the goods back twice.
    it('reports success when the restock fails, and stays voided', async () => {
      const { order, now } = await soldToday();
      inventory.restockError = new Error('depot-service down');

      const voided = await service.voidCounterSale(operator, order.id, 'Batal', now);

      expect(voided.status).toBe(OrderStatus.VOIDED);
      expect(orders.rows[0].status).toBe(OrderStatus.VOIDED);
    });

    it('stays voided when the franchise ledger cannot be corrected', async () => {
      const { order, now } = await soldToday();
      franchiseRevenue.voidError = new Error('payout down');
      const voided = await service.voidCounterSale(operator, order.id, 'Batal', now);
      expect(voided.status).toBe(OrderStatus.VOIDED);
    });

    it('stays voided when loyalty cannot take the points back', async () => {
      const { order, now } = await soldToday({ customerId: randomUUID(), customerPhone: '0812' });
      loyalty.reverseError = new Error('loyalty down');
      const voided = await service.voidCounterSale(operator, order.id, 'Batal', now);
      expect(voided.status).toBe(OrderStatus.VOIDED);
    });

    // A sale from a previous day belongs to a shift somebody already counted and signed off.
    it('refuses a sale from another day, in the depot timezone', async () => {
      const { order } = await soldToday();
      const tomorrow = new Date(order.createdAt.getTime() + 24 * 60 * 60 * 1000);
      await expect(
        service.voidCounterSale(operator, order.id, 'Batal', tomorrow),
      ).rejects.toBeInstanceOf(VoidWindowClosedError);
      expect(inventory.restockCalls).toHaveLength(0);
    });

    it('refuses a delivery order — that is what the refund queue is for', async () => {
      const delivery = await orders.create({
        orderNumber: 'HM-DEL-1',
        customerId: randomUUID(),
        depotId: DEPOT,
        status: OrderStatus.COMPLETED,
        subtotal: 10000,
        deliveryFee: 5000,
        discount: 0,
        total: 15000,
        recipientName: 'Budi',
        phone: '0812',
        addressLine: 'Jl. Test',
        city: '-',
        province: '-',
        postalCode: null,
        latitude: null,
        longitude: null,
        notes: null,
        items: [],
      });
      await expect(
        service.voidCounterSale(operator, delivery.id, 'Batal', NOW),
      ).rejects.toBeInstanceOf(NotACounterSaleError);
    });

    // Two cashiers hitting void on the same sale: only the first may restock and refund it.
    it('refuses a second void, and does not restock twice', async () => {
      const { order, now } = await soldToday();
      await service.voidCounterSale(operator, order.id, 'Batal', now);
      await expect(
        service.voidCounterSale(operator, order.id, 'Batal lagi', now),
      ).rejects.toBeInstanceOf(OrderAlreadyVoidedError);
      expect(inventory.restockCalls).toHaveLength(1);
    });

    // The money leg fails CLOSED, and it runs first: a sale marked reversed while
    // payment-service still holds the cash is revenue the depot does not have AND cash the
    // cashier can never account for.
    it('keeps the sale standing when the money cannot be given back', async () => {
      const { order, now } = await soldToday();
      paymentReversal.error = new PaymentReversalFailedError();

      await expect(
        service.voidCounterSale(operator, order.id, 'Batal', now),
      ).rejects.toBeInstanceOf(PaymentReversalFailedError);

      expect(orders.rows[0].status).toBe(OrderStatus.COMPLETED);
      expect(inventory.restockCalls).toHaveLength(0);
      expect(loyalty.reversals).toHaveLength(0);
    });

    it('refunds before it reverses — never the other way round', async () => {
      const { order, now } = await soldToday();
      await service.voidCounterSale(operator, order.id, 'Batal', now);
      // The guarded UPDATE would have rejected a second void; the refund landing first is
      // what makes the failure above recoverable by simply retrying.
      expect(paymentReversal.calls).toHaveLength(1);
      expect(orders.rows[0].status).toBe(OrderStatus.VOIDED);
    });

    it('refuses a depot-locked operator voiding another depot sale', async () => {
      const { order, now } = await soldToday();
      await expect(
        service.voidCounterSale(
          { ...operator, depotId: '22222222-2222-4222-8222-222222222222' },
          order.id,
          'Batal',
          now,
        ),
      ).rejects.toThrow();
    });
  });

  it('cannot be advanced or re-completed afterwards', async () => {
    const order = await sell(1);
    await expect(
      service.updateStatus(order.id, OrderStatus.COMPLETED, 'op-1'),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });
});
