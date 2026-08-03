import { randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import {
  BelowMinimumOrderError,
  CatalogUnavailableError,
  DepotRequiredError,
  DepotUnavailableError,
  EmptyCartError,
  InvalidStatusTransitionError,
  OrderAlreadyReviewedError,
  OrderAlreadyRoutedError,
  OrderNotCancellableError,
  OrderNotFoundError,
  OrderNotReviewableError,
  OutOfServiceAreaError,
  ProductUnavailableError,
  ResellerVoucherNotAllowedError,
  AnonymousVoucherNotAllowedError,
  ShippingVoucherAtCounterError,
  NoOpenShiftError,
} from '../../domain/errors';
import {
  OrderStatus,
  canTransition,
  isCancellable,
  notificationEventFor,
} from '../../domain/order-status';
import { ANONYMOUS_CUSTOMER_ID } from '../../domain/anonymous';
import { selectNearestDepot } from '../../domain/geo';
import { applyAdjustment, galonQuantity, percentDiscount } from '../../domain/pricing';
import { OrderConfigService } from '../../config/order-config.service';
import { Page, buildPage } from '../pagination';
import { CartRepository } from '../ports/cart.repository';
import {
  CreateOrderData,
  CreateOrderItemData,
  DeliveryAddressSnapshot,
  OrderQuery,
  OrderRecord,
  OrderRepository,
  OrderReviewRecord,
  OrderValue,
  RatingSummary,
} from '../ports/order.repository';
import { CatalogProduct, ProductCatalogPort } from '../ports/product-catalog.port';
import { DepotDirectoryPort, DepotLocation } from '../ports/depot-directory.port';
import { DepotPrice, DepotPricingPort } from '../ports/depot-pricing.port';
import { LoyaltyCoordinationPort } from '../ports/loyalty-coordination.port';
import { ReferralCoordinationPort } from '../ports/referral-coordination.port';
import { RecommendationCoordinationPort } from '../ports/recommendation-coordination.port';
import { FranchiseRevenuePort } from '../ports/franchise-revenue.port';
import { CashierShiftPort } from '../ports/cashier-shift.port';
import { ForecastCoordinationPort } from '../ports/forecast-coordination.port';
import { MembershipPort } from '../ports/membership.port';
import { ResellerDiscountPort } from '../ports/reseller-discount.port';
import { NotificationPort } from '../ports/notification.port';
import { PromoPort } from '../ports/promo.port';
import { InventoryPort } from '../ports/inventory.port';
import { ORDER_TOKENS } from '../tokens';
import { CartService, CartView } from './cart.service';

/** One counter sale: depot, lines, and an optional identified buyer. */
export interface WalkInSaleInput {
  depotId: string;
  lines: { productId: string; quantity: number }[];
  /** Resolved customer id when a phone was given; omitted for an anonymous sale. */
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  /** Voucher from the buyer's own wallet; only meaningful once they are identified. */
  voucherCode?: string | null;
}

export interface CheckoutInput {
  deliveryAddress: DeliveryAddressSnapshot;
  /**
   * Depot the customer picked, used only when the address carries no map pin so
   * automatic routing cannot run. Ignored when the address has coordinates.
   */
  depotId?: string | null;
  /** Optional voucher code to apply (validated against the promo-service). */
  voucherCode?: string | null;
  /** Optional customer-preferred delivery time-window (free-form label, not slot-checked). */
  deliveryWindow?: string | null;
}

export interface ListOrdersInput {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  depotIds?: readonly string[];
  /** HQ tray of orders that reached no depot (legacy fail-open rows). */
  unrouted?: boolean;
}

/** Rounds to 2 decimals (IDR minor units) to keep money arithmetic exact. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class OrderService {
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @Inject(ORDER_TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(ORDER_TOKENS.CartRepository) private readonly cart: CartRepository,
    @Inject(ORDER_TOKENS.ProductCatalog) private readonly catalog: ProductCatalogPort,
    @Inject(ORDER_TOKENS.DepotDirectory) private readonly depotDirectory: DepotDirectoryPort,
    @Inject(ORDER_TOKENS.DepotPricing) private readonly depotPricing: DepotPricingPort,
    @Inject(ORDER_TOKENS.LoyaltyCoordination)
    private readonly loyalty: LoyaltyCoordinationPort,
    @Inject(ORDER_TOKENS.ReferralCoordination)
    private readonly referral: ReferralCoordinationPort,
    @Inject(ORDER_TOKENS.Membership) private readonly membership: MembershipPort,
    @Inject(ORDER_TOKENS.ResellerDiscount) private readonly resellerDiscount: ResellerDiscountPort,
    @Inject(ORDER_TOKENS.Notification) private readonly notification: NotificationPort,
    @Inject(ORDER_TOKENS.Promo) private readonly promo: PromoPort,
    @Inject(ORDER_TOKENS.Inventory) private readonly inventory: InventoryPort,
    private readonly cartService: CartService,
    private readonly config: OrderConfigService,
    @Inject(ORDER_TOKENS.RecommendationCoordination)
    private readonly recommendation: RecommendationCoordinationPort,
    @Inject(ORDER_TOKENS.ForecastCoordination)
    private readonly forecastCoordination: ForecastCoordinationPort,
    @Inject(ORDER_TOKENS.FranchiseRevenue)
    private readonly franchiseRevenue: FranchiseRevenuePort,
    @Inject(ORDER_TOKENS.CashierShift)
    private readonly cashierShift: CashierShiftPort,
  ) {}

  /**
   * Places an order from the customer's cart. Prices are re-resolved from the
   * catalog (never trusts the client), the delivery address is snapshotted, and
   * the cart is cleared on success.
   */
  async checkout(
    customerId: string,
    input: CheckoutInput,
    authorization = '',
  ): Promise<OrderRecord> {
    const lines = await this.cart.findByCustomer(customerId);
    if (lines.length === 0) {
      throw new EmptyCartError();
    }

    // Route to the fulfilling depot first: it prices the goods (per-depot overrides),
    // the delivery fee, and the minimum order amount. Resolution is fail-CLOSED — an
    // order that reaches no depot is an order nobody can see or fulfil, so checkout
    // rejects instead (the customer picks a depot when the address has no map pin).
    const depot = await this.resolveDepot(input.deliveryAddress, input.depotId);

    const { items, subtotal, tierPricedTotal } = await this.priceLines(depot.id, lines);

    if (depot.minOrderAmount !== null && subtotal < depot.minOrderAmount) {
      throw new BelowMinimumOrderError(depot.minOrderAmount);
    }
    // Delivery is charged per galon (FR: Rp perUnitFee × galon count), not a flat
    // per-order fee. Non-galon lines (bottled dus, accessories) don't add to it.
    const deliveryFee = money(depot.deliveryFee * galonQuantity(items));

    // Reseller pricing (reseller-only): an active reseller with a percent gets a flat
    // discount off subtotal and NO membership/voucher. Fails open (null → normal pricing).
    const reseller = await this.resellerDiscount.get(authorization);
    const isReseller = reseller?.active === true && reseller.discountPct > 0;

    // voucherCode is null for resellers so the later redeem block is skipped too.
    const voucherCode = isReseller ? null : input.voucherCode?.trim().toUpperCase() || null;

    let discount: number;
    if (isReseller) {
      if (input.voucherCode?.trim()) throw new ResellerVoucherNotAllowedError();
      // Wholesale-priced lines are excluded from the reseller percentage — they are
      // already at the depot's bulk price and must not be discounted twice.
      const discountable = money(Math.max(0, subtotal - tierPricedTotal));
      discount = money(Math.min(subtotal, percentDiscount(discountable, reseller!.discountPct)));
    } else {
      // FR-032: the customer's membership tier gives an always-on discount on the
      // subtotal. Fails OPEN (0 rate) so a loyalty outage never blocks checkout.
      // Scoped to the fulfilling depot — it is the one absorbing the discount, and it
      // sets both the points needed for a tier and what that tier is worth there.
      const membershipRate = await this.membership.getDiscountRate(authorization, depot.id);
      const membershipDiscount = money(subtotal * membershipRate);

      // A supplied voucher is validated + priced by the promo-service. Fails CLOSED:
      // an invalid or unreachable voucher rejects checkout (VoucherRejectedError)
      // rather than silently dropping it.
      // A voucher discounts EITHER the goods (PERCENTAGE/FIXED) or the delivery fee
      // (FREE_SHIPPING) — never both. Keeping them apart is what lets each be capped
      // against the bill component it actually belongs to.
      let voucherValueDiscount = 0;
      let voucherShippingDiscount = 0;
      if (voucherCode) {
        // Pass the delivery fee so a FREE_SHIPPING voucher can waive it.
        const quote = await this.promo.quote(
          voucherCode,
          customerId,
          subtotal,
          deliveryFee,
          authorization,
        );
        if (quote.discountType === 'FREE_SHIPPING') {
          voucherShippingDiscount = quote.discount;
        } else {
          voucherValueDiscount = quote.discount;
        }
      }

      // M5-18: a discount on the goods may never eat into the delivery fee, so the
      // membership + value-voucher stack is capped at `subtotal` alone (BR-015 forbids
      // stacking multiple vouchers, not a voucher with a tier benefit). A FREE_SHIPPING
      // voucher is capped separately against the delivery fee it exists to waive, so a
      // small order with a large fee still gets its shipping fully covered.
      const valueDiscount = Math.min(subtotal, membershipDiscount + voucherValueDiscount);
      const shippingDiscount = Math.min(deliveryFee, voucherShippingDiscount);
      discount = money(valueDiscount + shippingDiscount);
    }
    const total = money(subtotal + deliveryFee - discount);

    const order = await this.reserveThenCreate(
      depot.id,
      {
        orderNumber: OrderService.newOrderNumber(),
        customerId,
        depotId: depot.id,
        subtotal,
        deliveryFee,
        discount,
        total,
        deliveryWindow: input.deliveryWindow ?? null,
        ...input.deliveryAddress,
        items,
      },
      authorization,
    );
    await this.cart.clear(customerId);

    // Record the redemption now that the order exists. Idempotent per order and
    // fail-open — a failure here never unwinds a placed order.
    if (voucherCode) {
      await this.promo.redeem(
        voucherCode,
        customerId,
        order.id,
        subtotal,
        deliveryFee,
        authorization,
      );
    }
    // FR-093/FR-094: confirm receipt of the placed order over WhatsApp. Fail-open
    // (the adapter never throws) — a notification hiccup must not unwind a placed order.
    await this.notification.notify(
      'ORDER_RECEIVED',
      order.phone,
      { name: order.recipientName, orderNumber: order.orderNumber },
      order.customerId,
      authorization,
    );
    return order;
  }

  /**
   * Depot-resolved prices turned into snapshotted order lines. The one block genuinely
   * shared by every order path (checkout, scheduled subscription runs, counter sales):
   * static per-depot override + the winning active pricing rule, with a matching wholesale
   * band outranking both as an absolute unit price (design 16b). Fails OPEN — no depot or
   * an empty price map means catalog base prices with no adjustment.
   *
   * `tierPricedTotal` is the rupiah that came from a wholesale band; only checkout uses it,
   * to keep the reseller percentage off bulk-priced lines (decided 2026-07-27).
   */
  private async priceLines(
    depotId: string | null,
    lines: { productId: string; quantity: number }[],
  ): Promise<{ items: CreateOrderItemData[]; subtotal: number; tierPricedTotal: number }> {
    const prices = depotId
      ? await this.depotPricing.getPrices(
          depotId,
          lines.map((l) => l.productId),
          lines.map((l) => l.quantity),
        )
      : new Map<string, DepotPrice>();

    const productById = await this.pricedAll(lines.map((l) => l.productId));
    const items: CreateOrderItemData[] = [];
    let tierPricedTotal = 0;
    for (const line of lines) {
      const product = productById.get(line.productId)!;
      const priceRow = prices.get(product.id);
      const base = priceRow?.sellPrice ?? product.basePrice;
      const adj = priceRow?.adjustType
        ? { adjustType: priceRow.adjustType, value: priceRow.value ?? 0 }
        : null;
      const tiered = typeof priceRow?.tierPrice === 'number';
      const unitPrice = tiered ? money(priceRow!.tierPrice!) : money(applyAdjustment(base, adj));
      const lineTotal = money(unitPrice * line.quantity);
      if (tiered) tierPricedTotal += lineTotal;
      items.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        // Frozen for the same reason unitPrice is: a later catalog restatement
        // (19L -> 19.2L) must not silently rewrite what past orders reconcile to.
        volumeMl: product.volumeMl,
        isGallon: product.isGallon,
        unitPrice,
        quantity: line.quantity,
        lineTotal,
      });
    }
    return {
      items,
      subtotal: money(items.reduce((sum, i) => sum + i.lineTotal, 0)),
      tierPricedTotal,
    };
  }

  /**
   * Place an order for explicit lines (no cart), for scheduled subscription deliveries
   * (spec 7b). No voucher; no membership discount (a scheduled run carries no customer
   * token → fail-open 0 rate). The subscription discount is read here rather than passed
   * in: it is a per-depot rate now, and the depot is only known after routing.
   */
  async placeScheduled(
    customerId: string,
    lines: { productId: string; quantity: number }[],
    address: DeliveryAddressSnapshot,
  ): Promise<OrderRecord> {
    if (lines.length === 0) throw new EmptyCartError();
    // Fail-closed like checkout. A subscription whose saved address has no map pin
    // cannot be routed and there is nobody to ask, so the sweep skips it with a log
    // (subscription.service isolates each run) instead of placing a lost order.
    const depot = await this.resolveDepot(address);
    const { items, subtotal } = await this.priceLines(depot.id, lines);
    const deliveryFee = money(depot.deliveryFee * galonQuantity(items));
    const discountRate = this.config.subscriptionDiscountRate(depot.id);
    const discount = money(Math.min(subtotal, subtotal * discountRate));
    const total = money(subtotal + deliveryFee - discount);

    const order = await this.reserveThenCreate(
      depot.id,
      {
        orderNumber: OrderService.newOrderNumber(),
        customerId,
        depotId: depot.id,
        subtotal,
        deliveryFee,
        discount,
        total,
        ...address,
        items,
      },
      '',
    );

    await this.notification.notify(
      'ORDER_RECEIVED',
      order.phone,
      { name: order.recipientName, orderNumber: order.orderNumber },
      order.customerId,
      '',
    );
    return order;
  }

  /**
   * Counter sale: the customer walked into the depot, paid cash and left with the goods.
   * No cart, no courier, no delivery fee, no voucher or membership stack.
   *
   * The row is created already COMPLETED and the completion fan-out is run directly, rather
   * than adding a shortcut edge to the status graph — TRANSITIONS keeps COMPLETED reachable
   * only from DELIVERED, so an ordinary delivery order still cannot skip the courier, and
   * TRANSITIONS[COMPLETED] being empty means the walk-in can never be advanced afterwards.
   *
   * `customerId` is the sentinel when the buyer gave no phone; runCompletion() then skips
   * everything identity-bound while still consuming stock and posting revenue.
   */
  async walkInSale(
    user: AuthenticatedUser,
    input: WalkInSaleInput,
    authorization = '',
  ): Promise<OrderRecord> {
    if (input.lines.length === 0) throw new EmptyCartError();
    assertDepotAccess(user, input.depotId);
    // Before anything is priced or held: cash is about to change hands, and it has to land
    // in a drawer somebody has opened in their own name and will count at the end.
    if (!(await this.cashierShift.hasOpenShift(input.depotId, authorization))) {
      throw new NoOpenShiftError();
    }

    const { items, subtotal } = await this.priceLines(input.depotId, input.lines);
    const customerId = input.customerId ?? ANONYMOUS_CUSTOMER_ID;
    const voucherCode = input.voucherCode?.trim().toUpperCase() || null;
    const discount = await this.counterDiscount(customerId, input.depotId, subtotal, voucherCode);

    // Reserve first: a shortfall must reject before any row exists. Consume then happens in
    // the completion fan-out, exactly as for a delivered order.
    const order = await this.reserveThenCreate(
      input.depotId,
      {
        orderNumber: OrderService.newOrderNumber(),
        customerId,
        depotId: input.depotId,
        status: OrderStatus.COMPLETED,
        isWalkIn: true,
        subtotal,
        deliveryFee: 0,
        discount,
        total: money(subtotal - discount),
        // The address snapshot columns are NOT NULL and are read by the receipt, the order
        // detail sheet and the driver app. For a counter sale they say who bought and where
        // they took delivery — at the counter.
        recipientName: input.customerName?.trim() || 'Pelanggan walk-in',
        phone: input.customerPhone?.trim() || '-',
        addressLine: 'Ambil langsung di depot',
        city: '-',
        province: '-',
        postalCode: null,
        latitude: null,
        longitude: null,
        notes: null,
        items,
      },
      authorization,
    );

    // Record the redemption now that the order exists — idempotent per order, fail-open,
    // exactly as at checkout.
    if (voucherCode) {
      await this.promo.redeem(voucherCode, customerId, order.id, subtotal, 0, authorization);
    }
    // No ORDER_RECEIVED: the goods are already in the buyer's hands.
    await this.runCompletion(order, authorization);
    return order;
  }

  /**
   * What comes off a counter sale: the buyer's membership tier plus, if they handed one over,
   * a voucher from their own wallet. Both are read by customer id over the internal path —
   * the call carries the CASHIER's token, so anything token-scoped would price the cashier.
   *
   * An anonymous sale gets neither: there is no wallet and no tier to read, and pretending
   * otherwise would be the cashier's benefit applied to a stranger. Membership fails OPEN
   * (0 rate), the voucher fails CLOSED — a voucher the buyer handed over must be honoured or
   * the sale must stop, never silently dropped at full price with the buyer watching.
   */
  private async counterDiscount(
    customerId: string,
    depotId: string,
    subtotal: number,
    voucherCode: string | null,
  ): Promise<number> {
    if (customerId === ANONYMOUS_CUSTOMER_ID) {
      if (voucherCode) throw new AnonymousVoucherNotAllowedError();
      return 0;
    }
    const membershipRate = await this.membership.getDiscountRateFor(customerId, depotId);
    let voucherDiscount = 0;
    if (voucherCode) {
      // No delivery fee exists at the counter, so a FREE_SHIPPING voucher would burn a
      // redemption for nothing. Refuse it rather than spend the buyer's voucher on air.
      const quote = await this.promo.quoteFor(voucherCode, customerId, subtotal, 0);
      if (quote.discountType === 'FREE_SHIPPING') throw new ShippingVoucherAtCounterError();
      voucherDiscount = quote.discount;
    }
    // Same ceiling as checkout: the stack can wipe out the goods, never go past them.
    return money(Math.min(subtotal, money(subtotal * membershipRate) + voucherDiscount));
  }

  /**
   * "Time to refill" nudge sweep (spec 5h): notify customers whose most-recent order
   * predates `days` ago. Ops/scheduler-triggered (mirrors expireAbandoned) — this repo
   * has no cron daemon. Each notification is fail-open (never throws).
   */
  async remindStaleCustomers(now: Date, days = 14, limit = 500): Promise<{ reminded: number }> {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const targets = await this.orders.findReorderReminderTargets(cutoff, limit);
    let reminded = 0;
    for (const target of targets) {
      const ok = await this.notification
        .notify(
          'REORDER_REMINDER',
          target.phone,
          { name: target.recipientName },
          target.customerId,
          '',
        )
        .then(() => true)
        .catch(() => false);
      if (ok) reminded += 1;
    }
    return { reminded };
  }

  async listForCustomer(customerId: string, input: ListOrdersInput): Promise<Page<OrderRecord>> {
    return this.search({ ...input, customerId });
  }

  /**
   * Internal keyset-paginated feed of COMPLETED orders for recommendation-service's
   * rebuild backfill (service-to-service, `GET /orders/internal/completed`).
   */
  async listCompletedPage(
    cursor: string | null,
    limit?: number,
  ): Promise<{ orders: OrderRecord[]; nextCursor: string | null }> {
    const clamped = Math.min(200, Math.max(1, limit ?? 100));
    return this.orders.findCompletedPage(cursor, clamped);
  }

  /** Total fulfilled sales for a depot in [from, to] — feeds hr-service SALES_TOTAL bonus rules. */
  sumDepotSales(depotId: string, from: Date, to: Date): Promise<number> {
    return this.orders.sumDepotSales(depotId, from, to);
  }

  /** Per-customer order aggregates for a depot's CRM lifecycle (Fase 4). */
  depotCustomerAggregates(depotId: string) {
    return this.orders.depotCustomerAggregates(depotId);
  }

  /** Staff view across all customers, optionally filtered by status. */
  async listAll(input: ListOrdersInput): Promise<Page<OrderRecord>> {
    return this.search(input);
  }

  /**
   * Staff assigns the fulfilling depot for an order that has none — the legacy rows
   * checkout used to create when routing failed open. Only ever fills a blank: an
   * order already at a depot keeps it, so this can't be used to move work between
   * depots behind the operator's back.
   *
   * Stock is NOT reserved retroactively: the reserve step never ran for these rows,
   * and silently holding stock now would surprise the depot mid-day. The operator
   * checks availability when they pick the order up.
   */
  async assignDepot(orderId: string, depotId: string): Promise<OrderRecord> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new OrderNotFoundError();
    if (order.depotId) throw new OrderAlreadyRoutedError();
    const depots = await this.depotDirectory.listActiveDepots();
    if (depots === null) throw new DepotUnavailableError();
    if (!depots.some((d) => d.id === depotId)) throw new DepotUnavailableError();
    return this.orders.assignDepot(orderId, depotId);
  }

  async getForCustomer(customerId: string, orderId: string): Promise<OrderRecord> {
    const order = await this.orders.findById(orderId);
    // Cross-tenant reads return 404 (never reveal another customer's order).
    if (!order || order.customerId !== customerId) {
      throw new OrderNotFoundError();
    }
    return order;
  }

  findOrderValues(orderIds: string[]): Promise<OrderValue[]> {
    return this.orders.findOrderValues(orderIds);
  }

  /** Spec 7c: rate a delivered/completed order (once). */
  async reviewOrder(
    customerId: string,
    orderId: string,
    input: { rating: number; aspects: string[]; comment?: string; tipAmount?: number },
  ): Promise<OrderReviewRecord> {
    const order = await this.getForCustomer(customerId, orderId);
    if (order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.COMPLETED) {
      throw new OrderNotReviewableError(order.status);
    }
    if (await this.orders.findReviewByOrderId(order.id)) {
      throw new OrderAlreadyReviewedError();
    }
    return this.orders.createReview({
      orderId: order.id,
      customerId,
      rating: input.rating,
      aspects: input.aspects,
      comment: input.comment?.trim() || null,
      tipAmount: input.tipAmount ?? 0,
    });
  }

  /** The customer's own review for an order, or null if not yet rated. */
  async getReview(customerId: string, orderId: string): Promise<OrderReviewRecord | null> {
    await this.getForCustomer(customerId, orderId); // ownership/404 guard
    return this.orders.findReviewByOrderId(orderId);
  }

  /** Mean rating over a set of orders — courier weekly performance (design 4c). */
  async ratingSummary(orderIds: string[]): Promise<RatingSummary> {
    return this.orders.avgRatingForOrders(orderIds);
  }

  async getAny(orderId: string): Promise<OrderRecord> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError();
    }
    return order;
  }

  /** BR-006: a customer may cancel only before a driver is assigned. */
  async cancel(
    customerId: string,
    orderId: string,
    reason?: string,
    authorization = '',
  ): Promise<OrderRecord> {
    const order = await this.getForCustomer(customerId, orderId);
    if (!isCancellable(order.status)) {
      throw new OrderNotCancellableError(order.status);
    }
    const cancelled = await this.orders.applyStatus(
      order.id,
      OrderStatus.CANCELLED,
      customerId,
      reason ?? null,
    );
    await this.releaseStock(cancelled, authorization);
    return cancelled;
  }

  /**
   * Auto-cancels orders that never went anywhere, releasing the stock they held.
   * Admin-triggered sweep (mirrors loyalty/expire). Two windows, because the two cases
   * are not the same risk:
   *
   * - CREATED beyond `abandonMinutes` — an order that was placed but never confirmed.
   *   (M4-18: this is NOT an abandoned cart. A cart that was never checked out has no
   *   order row at all and is swept by nothing here.)
   * - CONFIRMED / PREPARING beyond `stalledHours` — the depot accepted it and then
   *   nothing happened. These used to be swept by nothing at all, so an order that was
   *   never paid for held its reservation forever. The window is long and per-depot
   *   tunable precisely because a depot may legitimately be slow: payment here is direct
   *   to the depot, so "unpaid" is a normal state for a live order and is NOT the signal.
   *
   * Anything from DRIVER_ASSIGNED on is delivery-service's to close (a failed delivery
   * cancels its own order), so it is deliberately out of scope here.
   */
  async expireAbandoned(
    changedBy: string,
    authorization = '',
    olderThanMinutes?: number,
  ): Promise<{ cancelled: number }> {
    const minutes = olderThanMinutes ?? this.config.abandonMinutes;
    const now = Date.now();
    const sweeps: { statuses: OrderStatus[]; before: Date; note: string }[] = [
      {
        statuses: [OrderStatus.CREATED],
        before: new Date(now - minutes * 60_000),
        note: 'Auto-cancelled: order abandoned before confirmation.',
      },
      {
        statuses: [OrderStatus.CONFIRMED, OrderStatus.PREPARING],
        before: new Date(now - this.config.stalledHours * 3_600_000),
        note: 'Auto-cancelled: order stalled at the depot with no progress.',
      },
    ];
    let cancelledCount = 0;
    for (const sweep of sweeps) {
      const stale = await this.orders.findStaleIn(sweep.statuses, sweep.before);
      for (const order of stale) {
        const cancelled = await this.orders.applyStatus(
          order.id,
          OrderStatus.CANCELLED,
          changedBy,
          sweep.note,
        );
        await this.releaseStock(cancelled, authorization);
        cancelledCount += 1;
      }
    }
    return { cancelled: cancelledCount };
  }

  /**
   * Credits a completed order to the fulfilling depot's franchise owner (design 6a).
   * No depot, no owner, or an unreachable depot-service → nothing is posted; completion
   * itself is never affected.
   */
  private async postFranchiseRevenue(order: OrderRecord): Promise<void> {
    if (!order.depotId || !(order.total > 0)) return;
    const ownership = await this.depotDirectory.findOwner(order.depotId);
    if (!ownership) return;
    const franchiseOwnerId = ownership.ownerId;
    if (!franchiseOwnerId) {
      // An HKP depot has no owner by design; a WARALABA one without an owner means this
      // order's revenue and HQ's commission are booked for nobody. Never fail silently.
      if (ownership.ownershipType === 'WARALABA') {
        this.logger.error(
          `Franchise depot ${order.depotId} has no owner: revenue for order ${order.orderNumber} was not booked to any ledger.`,
        );
      }
      return;
    }
    await this.franchiseRevenue.orderCompleted({
      orderId: order.id,
      orderNumber: order.orderNumber,
      franchiseOwnerId,
      depotId: order.depotId,
      amountIdr: order.total,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Everything a completed order sets in motion. Every step is fail-open (a downstream
   * outage never blocks completion) and idempotent downstream, keyed by order id.
   *
   * A walk-in sale reaches this the same way a delivered order does, minus the four
   * identity-bound effects: an anonymous counter sale has no customer to give points to,
   * refer, or message. Stock, demand history and franchise revenue are NOT skipped — those
   * happened for real regardless of who bought.
   */
  private async runCompletion(updated: OrderRecord, authorization: string): Promise<void> {
    const anonymous = updated.customerId === ANONYMOUS_CUSTOMER_ID;

    if (!anonymous) {
      // BR-013: award loyalty points. The count comes back from loyalty-service, which
      // owns the (per-depot) earn rate — this used to be recomputed here against the
      // global 1 pt / Rp 1.000 and quoted the wrong number at any depot that overrode it.
      const pointsEarned = await this.loyalty.awardPoints(
        updated.customerId,
        updated.id,
        updated.subtotal,
        updated.depotId,
        authorization,
      );
      // Notify the customer of the points they just earned (spec 5h feed). Null = the
      // award failed or its count is unknown: stay silent rather than promise points.
      if (pointsEarned !== null && pointsEarned > 0) {
        await this.notification
          .notify(
            'POINTS_EARNED',
            updated.phone,
            {
              name: updated.recipientName,
              points: String(pointsEarned),
              orderNumber: updated.orderNumber,
            },
            updated.customerId,
            authorization,
          )
          .catch(() => {});
      }
      // FR-092: qualify a pending referral for this customer (rewards both parties).
      await this.referral.qualify(updated.customerId, updated.id, authorization);
    }
    // FR-067..074: deduct sold quantities from the fulfilling depot's stock.
    // Only when the order was routed to a depot; fail-open (never blocks completion).
    if (updated.depotId) {
      await this.inventory.consume(
        updated.depotId,
        updated.id,
        updated.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        authorization,
      );
    }
    // Feeds the recommendation-service read model (co-buy/reorder/trending).
    // Belt-and-suspenders: the adapter is already fail-open, but never let a bug
    // there escape and block completion.
    await this.recommendation.recordCompleted(updated).catch(() => {});
    // Feeds forecast-service's per-product/per-depot demand history. Same fail-open
    // guard as above — the adapter never throws, but never let a bug there block completion.
    await this.forecastCoordination.ingestCompletedOrder(updated).catch(() => {});
    // Design 6a: credit the fulfilling depot's franchise owner. Nothing wrote that
    // ledger before, so every owner balance and the HQ release queue read an empty
    // table. Fail-open and idempotent on the payout side (keyed by order id).
    await this.postFranchiseRevenue(updated).catch(() => {});
  }

  /**
   * Reserves the depot's stock, then writes the order — the one order-creating step every
   * path shares (checkout, scheduled subscription runs, counter sales).
   *
   * Reserving first is deliberate: a shortfall must reject before any row exists. What was
   * missing is the other half — a create that throws (a DB blip, a constraint) left the hold
   * standing with no order to ever release it, so the depot silently lost that stock until
   * opname. The compensating release only ever undoes a hold this call itself placed.
   */
  private async reserveThenCreate(
    depotId: string,
    data: Omit<CreateOrderData, 'id'>,
    authorization: string,
  ): Promise<OrderRecord> {
    const id = randomUUID();
    const lines = data.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    await this.inventory.reserve(depotId, id, lines, authorization);
    try {
      return await this.orders.create({ ...data, id });
    } catch (error) {
      // Fail-open like every other inventory call: what the caller must see is why the
      // order could not be written, never a release that also failed on the way out.
      await this.inventory.release(depotId, id, lines, authorization).catch(() => {});
      throw error;
    }
  }

  /** Releases any stock this order held (on cancellation). Fail-open, no-op if unrouted. */
  private async releaseStock(order: OrderRecord, authorization: string): Promise<void> {
    if (!order.depotId) {
      return;
    }
    await this.inventory.release(
      order.depotId,
      order.id,
      order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      authorization,
    );
  }

  /** BR-012: staff advance an order along the legal status graph. */
  async updateStatus(
    orderId: string,
    to: OrderStatus,
    changedBy: string,
    note?: string,
    authorization = '',
    driverName?: string,
    driverPhone?: string,
    estimatedArrivalAt?: string,
  ): Promise<OrderRecord> {
    const order = await this.getAny(orderId);
    if (!canTransition(order.status, to)) {
      throw new InvalidStatusTransitionError(order.status, to);
    }
    const updated = await this.orders.applyStatus(
      order.id,
      to,
      changedBy,
      note ?? null,
      to === OrderStatus.DRIVER_ASSIGNED ? (driverName ?? null) : undefined,
      to === OrderStatus.DRIVER_ASSIGNED ? (driverPhone ?? null) : undefined,
      to === OrderStatus.ON_DELIVERY && estimatedArrivalAt
        ? new Date(estimatedArrivalAt)
        : undefined,
    );
    if (to === OrderStatus.COMPLETED) {
      await this.runCompletion(updated, authorization);
    }
    // Staff cancellation releases any stock the order held (customer cancels go through cancel()).
    if (to === OrderStatus.CANCELLED) {
      await this.releaseStock(updated, authorization);
    }
    // FR-093/FR-094: notify the customer over WhatsApp on notable lifecycle changes.
    // Delivery progress reaches here too — delivery-service advances the order status
    // over HTTP, so ON_DELIVERY/DELIVERED notifications flow through this one point.
    const event = notificationEventFor(to);
    if (event) {
      await this.notification.notify(
        event,
        updated.phone,
        { name: updated.recipientName, orderNumber: updated.orderNumber },
        updated.customerId,
        authorization,
      );
    }
    return updated;
  }

  /**
   * Confirms an order once its payment settles PAID. Called by payment-service over the
   * internal service-auth path (no end-user token). Advances CREATED→CONFIRMED, which
   * fires the ORDER_CONFIRMED WhatsApp. Idempotent: an order already past CREATED
   * (staff-confirmed, in delivery, completed, or cancelled) is left untouched, so a
   * duplicate webhook or a cash-on-delivery confirm is a safe no-op.
   */
  async confirmPaid(orderId: string, changedBy: string): Promise<OrderRecord> {
    const order = await this.getAny(orderId);
    if (order.status !== OrderStatus.CREATED) {
      return order;
    }
    return this.updateStatus(orderId, OrderStatus.CONFIRMED, changedBy);
  }

  /** Record a settled refund amount on the order (payment-service coordination, 22a). */
  async recordRefund(orderId: string, amount: number): Promise<void> {
    await this.getAny(orderId); // 404 if the order doesn't exist
    await this.orders.recordRefund(orderId, amount);
  }

  /** Re-adds an order's still-available lines back into the customer's cart. */
  async repeat(customerId: string, orderId: string): Promise<CartView> {
    const order = await this.getForCustomer(customerId, orderId);
    for (const item of order.items) {
      const product = await this.catalog.getProduct(item.productId);
      if (product && product.active) {
        await this.cart.upsert(customerId, item.productId, item.quantity);
      }
    }
    return this.cartService.view(customerId);
  }

  /**
   * Resolves the fulfilling depot for a delivery address, and never returns null.
   *
   * This used to fail OPEN — an address with no map pin, or a directory outage,
   * placed the order with `depotId = null`. Such an order matches no depot queue
   * (`IN` filters skip nulls), reserves no stock, and can never be dispatched: it
   * is lost the moment it is placed. So every path now ends in a depot or an error
   * the caller can act on:
   *   - address has coordinates  → nearest depot within radius, else out-of-service
   *   - no coordinates           → the depot the customer picked (`requestedDepotId`)
   *   - neither                  → DepotRequiredError, so the UI can ask
   *   - directory down / no depots → DepotUnavailableError (retry later)
   */
  private async resolveDepot(
    address: DeliveryAddressSnapshot,
    requestedDepotId?: string | null,
  ): Promise<DepotLocation> {
    const depots = await this.depotDirectory.listActiveDepots();
    if (depots === null || depots.length === 0) {
      throw new DepotUnavailableError();
    }
    if (address.latitude !== null && address.longitude !== null) {
      const nearest = selectNearestDepot(address.latitude, address.longitude, depots);
      if (!nearest) throw new OutOfServiceAreaError();
      return nearest;
    }
    if (!requestedDepotId) throw new DepotRequiredError();
    const picked = depots.find((d) => d.id === requestedDepotId);
    if (!picked) throw new DepotUnavailableError();
    return picked;
  }

  private async priced(productId: string): Promise<CatalogProduct> {
    let product;
    try {
      product = await this.catalog.getProduct(productId);
    } catch {
      throw new CatalogUnavailableError();
    }
    if (!product || !product.active) {
      throw new ProductUnavailableError(productId);
    }
    return product;
  }

  /**
   * Resolve + validate every line's product in ONE parallel fan-out instead of N sequential
   * awaits (DB-7). Same fail semantics as priced(): CatalogUnavailableError on a fetch
   * failure, ProductUnavailableError for a missing/inactive product. ponytail: N parallel
   * HTTP calls, not a product-service bulk endpoint — carts are small; add getProducts(ids)
   * upstream only if catalog fan-out ever dominates checkout latency.
   */
  private async pricedAll(productIds: string[]): Promise<Map<string, CatalogProduct>> {
    const unique = [...new Set(productIds)];
    const products = await Promise.all(unique.map((id) => this.priced(id)));
    return new Map(unique.map((id, i) => [id, products[i]]));
  }

  private async search(
    input: ListOrdersInput & { customerId?: string },
  ): Promise<Page<OrderRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(OrderService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const query: OrderQuery = {
      page,
      limit,
      customerId: input.customerId,
      status: input.status,
      depotIds: input.depotIds,
      unrouted: input.unrouted,
    };
    const { items, total } = await this.orders.search(query);
    return buildPage(items, total, page, limit);
  }

  private static newOrderNumber(): string {
    const now = new Date();
    const ymd =
      now.getUTCFullYear().toString() +
      String(now.getUTCMonth() + 1).padStart(2, '0') +
      String(now.getUTCDate()).padStart(2, '0');
    const suffix = String(randomInt(0, 1_000_000)).padStart(6, '0');
    return `HM-${ymd}-${suffix}`;
  }
}
