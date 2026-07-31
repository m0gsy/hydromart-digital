import { randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import {
  BelowMinimumOrderError,
  CatalogUnavailableError,
  EmptyCartError,
  InvalidStatusTransitionError,
  OrderAlreadyReviewedError,
  OrderNotCancellableError,
  OrderNotFoundError,
  OrderNotReviewableError,
  OutOfServiceAreaError,
  ProductUnavailableError,
  ResellerVoucherNotAllowedError,
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
}

export interface CheckoutInput {
  deliveryAddress: DeliveryAddressSnapshot;
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
}

/** Rounds to 2 decimals (IDR minor units) to keep money arithmetic exact. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

// loyalty-service is the source of truth for the balance (BR-013: 1 pt / Rp 1.000 subtotal).
// This mirrors that rate ONLY to render the "points earned" notification copy without a
// round-trip. Single definition so the magic divisor can't silently drift (ARCH-2).
const RUPIAH_PER_POINT = 1000;
function pointsForSubtotal(subtotal: number): number {
  return Math.floor(subtotal / RUPIAH_PER_POINT);
}

@Injectable()
export class OrderService {
  private static readonly MAX_LIMIT = 100;

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
    // the delivery fee, and the minimum order amount. Routing is fail-OPEN (null depot
    // when the address has no coordinates, the directory is unreachable, or no depots
    // are configured), in which case we fall back to catalog prices + the flat config
    // fee and skip the minimum. But an address outside every known depot's radius is
    // rejected (OutOfServiceAreaError) rather than placed unfulfillable.
    const depot = await this.routeDepot(input.deliveryAddress);

    const { items, subtotal, tierPricedTotal } = await this.priceLines(depot?.id ?? null, lines);

    if (depot && depot.minOrderAmount !== null && subtotal < depot.minOrderAmount) {
      throw new BelowMinimumOrderError(depot.minOrderAmount);
    }
    // Delivery is charged per galon (FR: Rp perUnitFee × galon count), not a flat
    // per-order fee. Non-galon lines (bottled dus, accessories) don't add to it.
    const perUnitFee = depot ? depot.deliveryFee : this.config.deliveryFee(null);
    const deliveryFee = money(perUnitFee * galonQuantity(items));

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
      const membershipRate = await this.membership.getDiscountRate(authorization);
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

    // Reserve stock BEFORE creating the order so an insufficient-stock reject leaves
    // no dangling order. Keyed by a pre-generated id. Only when routed to a depot;
    // reserve fails OPEN except on a genuine shortfall (throws InsufficientStockError).
    const orderId = randomUUID();
    if (depot) {
      await this.inventory.reserve(
        depot.id,
        orderId,
        items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        authorization,
      );
    }

    const order = await this.orders.create({
      id: orderId,
      orderNumber: OrderService.newOrderNumber(),
      customerId,
      depotId: depot?.id ?? null,
      subtotal,
      deliveryFee,
      discount,
      total,
      deliveryWindow: input.deliveryWindow ?? null,
      ...input.deliveryAddress,
      items,
    });
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
        unitPrice,
        quantity: line.quantity,
        lineTotal,
      });
    }
    return { items, subtotal: money(items.reduce((sum, i) => sum + i.lineTotal, 0)), tierPricedTotal };
  }

  /**
   * Place an order for explicit lines (no cart), for scheduled subscription deliveries
   * (spec 7b). No voucher; no membership discount (a scheduled run carries no customer
   * token → fail-open 0 rate).
   */
  async placeScheduled(
    customerId: string,
    lines: { productId: string; quantity: number }[],
    address: DeliveryAddressSnapshot,
    discountRate = 0,
  ): Promise<OrderRecord> {
    if (lines.length === 0) throw new EmptyCartError();
    const depot = await this.routeDepot(address);
    const { items, subtotal } = await this.priceLines(depot?.id ?? null, lines);
    const perUnitFee = depot ? depot.deliveryFee : this.config.deliveryFee(null);
    const deliveryFee = money(perUnitFee * galonQuantity(items));
    const discount = money(Math.min(subtotal, subtotal * discountRate));
    const total = money(subtotal + deliveryFee - discount);

    const orderId = randomUUID();
    if (depot) {
      await this.inventory.reserve(
        depot.id,
        orderId,
        items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        '',
      );
    }

    const order = await this.orders.create({
      id: orderId,
      orderNumber: OrderService.newOrderNumber(),
      customerId,
      depotId: depot?.id ?? null,
      subtotal,
      deliveryFee,
      discount,
      total,
      ...address,
      items,
    });

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

    const { items, subtotal } = await this.priceLines(input.depotId, input.lines);
    const orderId = randomUUID();
    // Reserve first: a shortfall must reject before any row exists. Consume then happens in
    // the completion fan-out, exactly as for a delivered order.
    await this.inventory.reserve(
      input.depotId,
      orderId,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      authorization,
    );

    const order = await this.orders.create({
      id: orderId,
      orderNumber: OrderService.newOrderNumber(),
      customerId: input.customerId ?? ANONYMOUS_CUSTOMER_ID,
      depotId: input.depotId,
      status: OrderStatus.COMPLETED,
      isWalkIn: true,
      subtotal,
      deliveryFee: 0,
      discount: 0,
      total: subtotal,
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
    });

    // No ORDER_RECEIVED: the goods are already in the buyer's hands.
    await this.runCompletion(order, authorization);
    return order;
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
    const franchiseOwnerId = await this.depotDirectory.findOwnerId(order.depotId);
    if (!franchiseOwnerId) return;
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
      // BR-013: award loyalty points.
      await this.loyalty.awardPoints(
        updated.customerId,
        updated.id,
        updated.subtotal,
        updated.depotId,
        authorization,
      );
      // Notify the customer of the points they just earned (spec 5h feed). Points mirror
      // loyalty's BR-013 rate (1 pt / Rp 1.000 subtotal); computed here only for the
      // message copy — loyalty-service remains the source of truth for the balance.
      // ponytail: this copy uses the global rate and may differ from a depot-overridden
      // earn rate; the awarded balance itself (via awardPoints above) is still correct.
      const pointsEarned = pointsForSubtotal(updated.subtotal);
      if (pointsEarned > 0) {
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
   * Resolves the fulfilling depot for a delivery address (nearest active depot
   * within its service radius). Fails OPEN (null depot) when the address has no
   * coordinates, the directory is unreachable, or the platform has no active
   * depots. But when the directory DID return depots and none covers the address,
   * the address is genuinely out of service area — reject rather than place an
   * order no depot can fulfill.
   */
  private async routeDepot(address: DeliveryAddressSnapshot): Promise<DepotLocation | null> {
    if (address.latitude === null || address.longitude === null) {
      return null;
    }
    const depots = await this.depotDirectory.listActiveDepots();
    if (depots === null) {
      return null; // directory unreachable — stay fail-open, leave unrouted
    }
    const depot = selectNearestDepot(address.latitude, address.longitude, depots);
    if (!depot && depots.length > 0) {
      throw new OutOfServiceAreaError();
    }
    return depot;
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
