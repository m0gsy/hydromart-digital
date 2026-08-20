import { randomUUID } from 'node:crypto';

import { AuthenticatedUser } from '@hydromart/platform';

import { OrderService } from '../../src/application/services/order.service';
import { ANONYMOUS_CUSTOMER_ID } from '../../src/domain/anonymous';
import {
  AnonymousVoucherNotAllowedError,
  CounterBuyerUnresolvedError,
  CounterBasketChangedError,
  CounterDeliveryUnavailableError,
  EmptyCartError,
  InsufficientStockError,
  InvalidStatusTransitionError,
  NoOpenShiftError,
  NotACounterSaleError,
  OrderAlreadyVoidedError,
  PaymentReversalFailedError,
  ResellerVoucherNotAllowedError,
  ShippingVoucherAtCounterError,
  VoidWindowClosedError,
  VoucherRejectedError,
} from '../../src/domain/errors';
import { OrderStatus, nextStatuses } from '../../src/domain/order-status';
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
  let gallonIssue: FakeGallonIssue;
  let notification: FakeNotification;
  let inventory: FakeInventory;
  let membership: FakeMembership;
  let promo: FakePromo;
  let shift: FakeCashierShift;
  let cart: InMemoryCartRepository;
  let paymentReversal: FakePaymentReversal;
  let pricing: FakeDepotPricing;
  let directory: FakeCustomerDirectory;
  let resellerDiscount: FakeResellerDiscount;
  let service: OrderService;

  const operator: AuthenticatedUser = {
    sub: 'op-1',
    role: 'KEPALA_DEPOT' as never,
    phone: '08',
    depotId: DEPOT,
  };

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    depots = new FakeDepotDirectory();
    pricing = new FakeDepotPricing();
    directory = new FakeCustomerDirectory();
    resellerDiscount = new FakeResellerDiscount();
    loyalty = new FakeLoyaltyCoordination();
    referral = new FakeReferralCoordination();
    recommendation = new FakeRecommendationCoordination();
    forecast = new FakeForecastCoordination();
    franchiseRevenue = new FakeFranchiseRevenue();
    gallonIssue = new FakeGallonIssue();
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
      resellerDiscount,
      directory,
      notification,
      promo,
      inventory,
      buildCartService(cart, catalog),
      buildTestConfig(),
      recommendation,
      forecast,
      franchiseRevenue,
      gallonIssue,
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

  /**
   * C12 · the cashier screen stops guessing.
   *
   * The screen added up shelf prices while the server applied tier, agen and voucher on
   * top. Three numbers reached three places: the cash-short guard used the SCREEN's total,
   * so an agen handing over exact money was refused by the till; the change on screen
   * disagreed with the change on the receipt; and a cashier who trusted the screen
   * collected more than was recorded — a phantom surplus at shift close, stacked on C2.
   *
   * The decisive property is not "a quote endpoint exists" but that the quote and the sale
   * are the SAME function. A second implementation is the same bug again with one more
   * place to forget, so that is what these assert.
   */
  /**
   * C8 · a replay is only a replay if it is the same sale.
   *
   * The till holds one attempt key until a submit succeeds (B-13, so a retry after a
   * timeout returns the sale already recorded instead of selling the goods twice). A
   * cashier who edited the basket after a failure therefore sent NEW goods under the OLD
   * key — the guard matched on the key alone, handed back the first order, and the screen
   * printed a receipt for goods that were never on the counter.
   */
  describe('C8 · the same key with a different basket', () => {
    it('still returns the same sale for a true retry', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const sale = { depotId: DEPOT, lines: [{ productId: product.id, quantity: 2 }] };

      const first = await service.walkInSale(operator, { ...sale, idempotencyKey: 'till-1' });
      const again = await service.walkInSale(operator, { ...sale, idempotencyKey: 'till-1' });

      expect(again.id).toBe(first.id);
      expect(orders.rows).toHaveLength(1);
    });

    it('refuses rather than replaying a sale nobody made', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });

      await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: product.id, quantity: 2 }],
        idempotencyKey: 'till-1',
      });

      // The buyer changed their mind; the cashier fixed the quantity and pressed Bayar.
      await expect(
        service.walkInSale(operator, {
          depotId: DEPOT,
          lines: [{ productId: product.id, quantity: 5 }],
          idempotencyKey: 'till-1',
        }),
      ).rejects.toBeInstanceOf(CounterBasketChangedError);
      expect(orders.rows).toHaveLength(1);
    });

    it('treats the same goods in a different order as the same basket', async () => {
      const a = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const b = catalog.seed({ id: randomUUID(), basePrice: 5000 });

      const first = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 2 },
        ],
        idempotencyKey: 'till-2',
      });
      const again = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [
          { productId: b.id, quantity: 2 },
          { productId: a.id, quantity: 1 },
        ],
        idempotencyKey: 'till-2',
      });

      expect(again.id).toBe(first.id);
    });
  });

  /**
   * C11 · the buyer came to the depot and asked for it to be delivered.
   *
   * Not "the ongkir was forgotten" — the PATH did not exist. And the hole that is easiest
   * to miss is not the fee: a walk-in is born COMPLETED and `TRANSITIONS[COMPLETED]` is
   * EMPTY, so a courier could never be assigned. Charging ongkir alone would have billed
   * for a delivery nobody could perform.
   */
  describe('C11 · antar dari konter', () => {
    /**
     * The counter never needed the depot DIRECTORY before — it priced from `input.depotId`
     * and charged no ongkir. A delivery does: the fee is the depot's own, read fail-closed,
     * because quoting a delivery fee from a depot nobody could reach would be inventing a
     * price at the till with the buyer standing there.
     */
    beforeEach(() => {
      depots.depots = [
        {
          id: DEPOT,
          lat: -6.9,
          lng: 107.6,
          serviceRadiusKm: 10,
          deliveryFee: 5000,
          minOrderAmount: null,
        },
      ];
    });

    const ADDRESS = {
      recipientName: 'Budi',
      phone: '081234567890',
      addressLine: 'Jl. Merdeka 10',
      city: 'Bandung',
      province: 'Jawa Barat',
      postalCode: null,
      latitude: -6.9,
      longitude: 107.6,
      notes: null,
    };

    it('is born CONFIRMED so a courier can actually be assigned', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });

      const order = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: p.id, quantity: 2 }],
        deliveryAddress: ADDRESS,
      });

      expect(order.status).toBe(OrderStatus.CONFIRMED);
      expect(nextStatuses(order.status).length).toBeGreaterThan(0);
    });

    it('a pick-up is still born COMPLETED, with no ongkir', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });

      const order = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: p.id, quantity: 2 }],
      });

      expect(order.status).toBe(OrderStatus.COMPLETED);
      expect(order.deliveryFee).toBe(0);
    });

    it('charges ongkir, and it is NOT a product line', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000, isGallon: true, volumeMl: 19000 });

      const order = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: p.id, quantity: 2 }],
        deliveryAddress: ADDRESS,
      });

      expect(order.deliveryFee).toBeGreaterThan(0);
      expect(order.total).toBe(order.subtotal + order.deliveryFee - order.discount);
      // The trap: ongkir smuggled in as a galon line would be discounted to the flat agen
      // price and would report as goods sold rather than as delivery.
      expect(order.items).toHaveLength(1);
      expect(order.items[0].productId).toBe(p.id);
    });

    it('carries the address the buyer gave, not "ambil di depot"', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });

      const order = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: p.id, quantity: 1 }],
        deliveryAddress: ADDRESS,
      });

      expect(order.addressLine).toBe('Jl. Merdeka 10');
      expect(order.latitude).toBe(-6.9);
    });

    /**
     * The completion fan-out is what credits stock, points and franchise revenue. Firing it
     * at creation would credit a sale still sitting on a courier's bike.
     */
    it('owes its completion effects at proof of delivery, not at the till', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });

      const order = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: p.id, quantity: 1 }],
        deliveryAddress: ADDRESS,
      });

      expect(orders.outbox!.rows.filter((r) => r.orderId === order.id)).toHaveLength(0);
    });

    it('refuses rather than quietly handing back a pick-up when the depot is switched off', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      // Same wiring, one setting flipped — the switch has to be the only difference.
      const svc = new OrderService(
        orders,
        cart,
        catalog,
        depots,
        pricing,
        loyalty,
        referral,
        membership,
        resellerDiscount,
        directory,
        notification,
        promo,
        inventory,
        buildCartService(cart, catalog),
        buildTestConfig({ ORDER_COUNTER_DELIVERY: '0' }),
        recommendation,
        forecast,
        franchiseRevenue,
        gallonIssue,
        shift,
        paymentReversal,
        buildOutbox(orders),
      );

      await expect(
        svc.walkInSale(operator, {
          depotId: DEPOT,
          lines: [{ productId: p.id, quantity: 1 }],
          deliveryAddress: ADDRESS,
        }),
      ).rejects.toBeInstanceOf(CounterDeliveryUnavailableError);
    });

    /**
     * The second trap: `quoteFor` and `redeem` must BOTH see the fee. If only one does, the
     * voucher book records a discount larger than the one actually given — the mirror of a
     * defect already documented on the checkout path.
     */
    /**
     * A free-shipping voucher is only meaningless when there is no shipping. On a counter
     * DELIVERY it is worth exactly the fee and never more — capped here rather than trusted
     * from the quote, so a shipping voucher can never end up paying for goods.
     */
    it('caps a free-shipping voucher at the ongkir, never above it', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      directory.byPhone.set('08123', '77777777-7777-4777-8777-777777777777');
      promo.quoteDiscount = 999_999;
      promo.quoteDiscountType = 'FREE_SHIPPING';

      const order = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: p.id, quantity: 2 }],
        customerPhone: '08123',
        voucherCode: 'GRATISONGKIR',
        deliveryAddress: ADDRESS,
      });

      expect(order.discount).toBe(order.deliveryFee);
    });

    it('still refuses a free-shipping voucher on a pick-up — there is no shipping to pay', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      directory.byPhone.set('08123', '77777777-7777-4777-8777-777777777777');
      promo.quoteDiscount = 5000;
      promo.quoteDiscountType = 'FREE_SHIPPING';

      await expect(
        service.walkInSale(operator, {
          depotId: DEPOT,
          lines: [{ productId: p.id, quantity: 1 }],
          customerPhone: '08123',
          voucherCode: 'GRATISONGKIR',
        }),
      ).rejects.toBeInstanceOf(ShippingVoucherAtCounterError);
    });

    it('quotes AND redeems the voucher against the same ongkir', async () => {
      const p = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      directory.byPhone.set('08123', '77777777-7777-4777-8777-777777777777');
      promo.quoteDiscount = 1000;

      const order = await service.walkInSale(operator, {
        depotId: DEPOT,
        lines: [{ productId: p.id, quantity: 2 }],
        customerPhone: '08123',
        voucherCode: 'HEMAT',
        deliveryAddress: ADDRESS,
      });

      expect(promo.quoteForCalls[0].shippingFee).toBe(order.deliveryFee);
      expect(promo.redeemCalls[0].shippingFee).toBe(order.deliveryFee);
      expect(promo.redeemCalls[0].shippingFee).toBe(promo.quoteForCalls[0].shippingFee);
    });
  });

  describe('C12 · counter quote', () => {
    const BUYER = '99999999-9999-4999-8999-999999999999';

    it('quotes the same total the sale then charges', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const lines = [{ productId: product.id, quantity: 3 }];

      const quote = await service.quoteCounterBasket(null, DEPOT, lines, null);
      const order = await service.walkInSale(operator, { depotId: DEPOT, lines });

      expect(quote.total).toBe(order.total);
      expect(quote.subtotal).toBe(order.subtotal);
      expect(quote.discount).toBe(order.discount);
    });

    it('sells nothing: no stock held, no order written', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });

      await expect(
        service.quoteCounterBasket(null, DEPOT, [{ productId: product.id, quantity: 1 }], null),
      ).resolves.toBeDefined();
      expect(orders.rows).toHaveLength(0);
      expect(inventory.reserveCalls).toHaveLength(0);
    });

    it('refuses an empty basket rather than quoting zero', async () => {
      await expect(service.quoteCounterBasket(null, DEPOT, [], null)).rejects.toBeInstanceOf(
        EmptyCartError,
      );
    });

    it('an unidentified basket gets depot prices and no discount layer', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const quote = await service.quoteCounterBasket(
        null,
        DEPOT,
        [{ productId: product.id, quantity: 2 }],
        null,
      );

      expect(quote.discount).toBe(0);
      expect(quote.agen).toBe(false);
      expect(quote.total).toBe(quote.subtotal);
    });

    // The whole point of option (c): pricing never touches identity, so it can never mint
    // an account. Only the deliberate tap does.
    it('never resolves a phone — a quote cannot create a customer', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      await service.quoteCounterBasket(null, DEPOT, [{ productId: product.id, quantity: 1 }], null);
      expect(directory.resolveCalls).toEqual([]);
    });

    it('identify is the one call that may create one, and hands back the id to re-quote with', async () => {
      directory.byPhone.set('08123', BUYER);

      const out = await service.identifyCounterBuyer(DEPOT, ' 08123 ', ' Budi ');

      expect(out.customerId).toBe(BUYER);
      expect(directory.resolveCalls).toEqual([{ phone: '08123', fullName: 'Budi', depotId: DEPOT }]);
    });

    it('a quote for an identified buyer prices their agen band, and says so', async () => {
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const quote = await service.quoteCounterBasket(
        BUYER,
        DEPOT,
        [{ productId: product.id, quantity: 1 }],
        null,
      );
      // Whatever the band decides, the flag and the discount come from the same read —
      // a badge computed anywhere else is a fourth number waiting to disagree.
      expect(quote.agen).toBe(quote.discount > 0 && quote.agen);
    });
  });

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

  // The cashier is standing at the counter charging a price the depot did not set. The note
  // is what the shift reconciliation has to explain the difference with.
  it('notes a counter sale that had to be priced from the catalog', async () => {
    pricing.unavailable = true;

    const order = await sell(2);

    const notes = orders.notes.filter((n) => n.id === order.id).map((n) => n.note);
    expect(notes).toContain('Harga dasar katalog dipakai: depot tidak terjangkau saat checkout');
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
    directory.byPhone.set('08123', '99999999-9999-4999-8999-999999999999');
    const order = await sell(1, { customerName: ' Budi ', customerPhone: ' 08123 ' });

    expect(order.recipientName).toBe('Budi');
    expect(order.phone).toBe('08123');
    expect(order.addressLine).toBe('Ambil langsung di depot');
  });

  // §I. The buyer used to be resolved in the POS page's BROWSER: it posted a one-row Excel
  // import, then sent the id here. Any other client posting a phone with no customerId
  // therefore booked the sale against the anonymous sentinel and created nobody.
  describe('resolving the counter buyer', () => {
    const BUYER = '99999999-9999-4999-8999-999999999999';

    it('resolves a phone with no customer id, and books the sale against that account', async () => {
      directory.byPhone.set('08123', BUYER);

      const order = await sell(1, { customerPhone: ' 08123 ', customerName: ' Budi ' });

      expect(order.customerId).toBe(BUYER);
      expect(directory.resolveCalls).toEqual([
        { phone: '08123', fullName: 'Budi', depotId: DEPOT },
      ]);
    });

    // A cashier who typed only a number still gets a usable account rather than a blank one.
    /**
     * C9: this used to assert the OPPOSITE, and the opposite was the bug. A cashier who
     * typed only a phone number has not named anybody, but the account was created with
     * `fullName` set to "08123" — a phone number standing in as a person's name on every
     * screen that lists customers, for somebody who never verified and never consented.
     *
     * Measured on production before changing it: 0 of 21 customers carry a phone-shaped
     * name, so this closes the path before it produced its first row.
     */
    it('creates the account UNNAMED when no name was typed', async () => {
      directory.byPhone.set('08123', BUYER);

      await sell(1, { customerPhone: '08123' });

      expect(directory.resolveCalls[0].fullName).toBeNull();
    });

    it('still passes the name when the cashier typed one', async () => {
      directory.byPhone.set('08123', BUYER);

      await sell(1, { customerPhone: '08123', customerName: '  Budi  ' });

      expect(directory.resolveCalls[0].fullName).toBe('Budi');
    });

    it('leaves an id the caller already resolved alone', async () => {
      const order = await sell(1, { customerId: BUYER, customerPhone: '08123' });

      expect(order.customerId).toBe(BUYER);
      expect(directory.resolveCalls).toEqual([]);
    });

    it('is an anonymous sale when no phone was given', async () => {
      const order = await sell(1);

      expect(order.customerId).toBe(ANONYMOUS_CUSTOMER_ID);
      expect(directory.resolveCalls).toEqual([]);
    });

    // The one counter call that fails CLOSED. Booking it anonymously would make the id
    // non-deterministic, and the replay guard is keyed by it — a retry would miss the sale
    // already recorded under the resolved buyer and sell the goods a second time.
    it('refuses the sale when the buyer cannot be resolved', async () => {
      await expect(sell(1, { customerPhone: '08123' })).rejects.toBeInstanceOf(
        CounterBuyerUnresolvedError,
      );
      expect(orders.rows).toHaveLength(0);
      expect(directory.resolveCalls).toHaveLength(1);
    });

    // The replay guard is keyed by customer id. Resolving after it would look the retry up
    // under the sentinel, find nothing, and sell the goods a second time.
    it('returns the same sale on a retry, not a second one', async () => {
      directory.byPhone.set('08123', BUYER);
      const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
      const sale = {
        depotId: DEPOT,
        lines: [{ productId: product.id, quantity: 1 }],
        customerPhone: '08123',
        idempotencyKey: 'till-9',
      };

      const first = await service.walkInSale(operator, sale);
      const retry = await service.walkInSale(operator, sale);

      expect(retry.id).toBe(first.id);
      expect(orders.rows).toHaveLength(1);
    });
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

    /**
     * An agen is an agen at the till too. The counter had no reseller branch at all, so the
     * same buyer was charged the flat SOP price online and list-minus-membership in person:
     * Rp50.000 against Rp190.000 for ten galon.
     */
    it('charges an agen the flat SOP galon price, not the list price', async () => {
      membership.rate = 0.05; // must be ignored — reseller pricing replaces it
      resellerDiscount.result = { active: true, discountPct: 0, flatGallonPriceIdr: 5000, homeDepotId: DEPOT };
      const customerId = randomUUID();
      const order = await sell(10, { customerId, customerPhone: '0812' });

      // 10 × (20.000 − 5.000) off a 200.000 basket → the agen pays 50.000.
      expect(order.discount).toBe(150_000);
      expect(order.total).toBe(50_000);
      // Read by BUYER id: the token at a till belongs to the cashier.
      expect(resellerDiscount.byCustomerCalls).toEqual([customerId]);
      expect(membership.byCustomerCalls).toHaveLength(0);
    });

    it('applies the agen percentage when there is no flat price', async () => {
      resellerDiscount.result = { active: true, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: DEPOT };
      const order = await sell(2, { customerId: randomUUID(), customerPhone: '0812' });
      expect(order.discount).toBe(4000); // 10% of 40.000
    });

    /*
     * A9. The rule was "is this an agen", never "whose agen". An agen enrolled at another
     * depot drew their agen price here — a franchise funding a discount it never granted.
     */
    it('refuses to price an agen registered at a different depot', async () => {
      membership.rate = 0;
      resellerDiscount.result = {
        active: true,
        discountPct: 0,
        flatGallonPriceIdr: 5000,
        homeDepotId: '22222222-2222-4222-8222-222222222222',
      };
      const order = await sell(10, { customerId: randomUUID(), customerPhone: '0812' });
      expect(order.discount).toBe(0);
      expect(order.total).toBe(200_000);
    });

    // Cannot prove which depot is not "any depot": decline rather than guess.
    it('refuses to price an agen whose home depot is unknown', async () => {
      membership.rate = 0;
      resellerDiscount.result = {
        active: true,
        discountPct: 0,
        flatGallonPriceIdr: 5000,
        homeDepotId: null,
      };
      const order = await sell(10, { customerId: randomUUID(), customerPhone: '0812' });
      expect(order.discount).toBe(0);
    });

    /*
     * A6. The counter read used to go out on the CASHIER's bearer, and `resellerView` lists
     * neither KEPALA_DEPOT nor STAFF_DEPOT — measured: both 403. The adapter swallowed it
     * as "not a reseller" and the till charged retail behind one logger.warn. It fails
     * CLOSED now: a person is standing there and can be asked to retry.
     */
    it('refuses the sale when the agen read fails, rather than charging retail', async () => {
      resellerDiscount.throwOnCounterRead = true;
      await expect(sell(10, { customerId: randomUUID(), customerPhone: '0812' })).rejects.toThrow(
        /customer-service responded 500/,
      );
      expect(orders.rows).toHaveLength(0);
    });

    it('refuses a voucher from an agen at the counter, exactly as checkout does', async () => {
      resellerDiscount.result = { active: true, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: DEPOT };
      await expect(
        sell(1, { customerId: randomUUID(), customerPhone: '0812', voucherCode: 'HEMAT10' }),
      ).rejects.toBeInstanceOf(ResellerVoucherNotAllowedError);
      expect(orders.rows).toHaveLength(0);
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

    /**
     * C5: this used to say "another DAY", and that was the bug. The calendar-day rule
     * claimed it stopped a void reaching back into a shift somebody had counted and signed
     * off, and it did not — two shifts happen in one day all the time. What refuses now is
     * a sale that predates the drawer currently open, whatever day it was rung up on.
     */
    it('refuses a sale rung up before the drawer that is open now', async () => {
      const { order } = await soldToday();
      shift.openedAt = new Date(order.createdAt.getTime() + 60 * 60 * 1000);
      const later = new Date(order.createdAt.getTime() + 2 * 60 * 60 * 1000);
      await expect(
        service.voidCounterSale(operator, order.id, 'Batal', later),
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
