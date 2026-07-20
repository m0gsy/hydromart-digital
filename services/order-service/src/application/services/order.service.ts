import { randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

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
} from '../../domain/errors';
import {
  OrderStatus,
  canTransition,
  isCancellable,
  notificationEventFor,
} from '../../domain/order-status';
import { selectNearestDepot } from '../../domain/geo';
import { applyAdjustment, galonQuantity } from '../../domain/pricing';
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
  RatingSummary,
} from '../ports/order.repository';
import { CatalogProduct, ProductCatalogPort } from '../ports/product-catalog.port';
import { DepotDirectoryPort, DepotLocation } from '../ports/depot-directory.port';
import { DepotPrice, DepotPricingPort } from '../ports/depot-pricing.port';
import { LoyaltyCoordinationPort } from '../ports/loyalty-coordination.port';
import { ReferralCoordinationPort } from '../ports/referral-coordination.port';
import { RecommendationCoordinationPort } from '../ports/recommendation-coordination.port';
import { ForecastCoordinationPort } from '../ports/forecast-coordination.port';
import { MembershipPort } from '../ports/membership.port';
import { NotificationPort } from '../ports/notification.port';
import { PromoPort } from '../ports/promo.port';
import { InventoryPort } from '../ports/inventory.port';
import { ORDER_TOKENS } from '../tokens';
import { CartService, CartView } from './cart.service';

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
  depotId?: string;
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
    @Inject(ORDER_TOKENS.Notification) private readonly notification: NotificationPort,
    @Inject(ORDER_TOKENS.Promo) private readonly promo: PromoPort,
    @Inject(ORDER_TOKENS.Inventory) private readonly inventory: InventoryPort,
    private readonly cartService: CartService,
    private readonly config: OrderConfigService,
    @Inject(ORDER_TOKENS.RecommendationCoordination)
    private readonly recommendation: RecommendationCoordinationPort,
    @Inject(ORDER_TOKENS.ForecastCoordination)
    private readonly forecastCoordination: ForecastCoordinationPort,
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

    // Per-depot resolved prices: static override + the winning active pricing rule
    // (WARALABA depots price independently). Fails OPEN — an empty map means every
    // line falls back to the catalog base price with no adjustment.
    const prices = depot
      ? await this.depotPricing.getPrices(
          depot.id,
          lines.map((l) => l.productId),
        )
      : new Map<string, DepotPrice>();

    const productById = await this.pricedAll(lines.map((l) => l.productId));
    const items: CreateOrderItemData[] = [];
    for (const line of lines) {
      const product = productById.get(line.productId)!;
      const priceRow = prices.get(product.id);
      const base = priceRow?.sellPrice ?? product.basePrice;
      const adj = priceRow?.adjustType
        ? { adjustType: priceRow.adjustType, value: priceRow.value ?? 0 }
        : null;
      const unitPrice = money(applyAdjustment(base, adj));
      items.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        unitPrice,
        quantity: line.quantity,
        lineTotal: money(unitPrice * line.quantity),
      });
    }

    const subtotal = money(items.reduce((sum, i) => sum + i.lineTotal, 0));

    if (depot && depot.minOrderAmount !== null && subtotal < depot.minOrderAmount) {
      throw new BelowMinimumOrderError(depot.minOrderAmount);
    }
    // Delivery is charged per galon (FR: Rp perUnitFee × galon count), not a flat
    // per-order fee. Non-galon lines (bottled dus, accessories) don't add to it.
    const perUnitFee = depot ? depot.deliveryFee : this.config.deliveryFee;
    const deliveryFee = money(perUnitFee * galonQuantity(items));

    // FR-032: the customer's membership tier gives an always-on discount on the
    // subtotal. Fails OPEN (0 rate) so a loyalty outage never blocks checkout.
    const membershipRate = await this.membership.getDiscountRate(authorization);
    const membershipDiscount = money(subtotal * membershipRate);

    // A supplied voucher is validated + priced by the promo-service. Fails CLOSED:
    // an invalid or unreachable voucher rejects checkout (VoucherRejectedError)
    // rather than silently dropping it.
    const voucherCode = input.voucherCode?.trim().toUpperCase() || null;
    let voucherDiscount = 0;
    if (voucherCode) {
      // Pass the delivery fee so a FREE_SHIPPING voucher can waive it.
      const quote = await this.promo.quote(voucherCode, customerId, subtotal, deliveryFee, authorization);
      voucherDiscount = quote.discount;
    }

    // Membership and voucher discounts stack (BR-015 forbids stacking multiple
    // vouchers, not a voucher with a tier benefit). The combined discount can never
    // exceed the whole bill — a FREE_SHIPPING voucher discounts against the delivery
    // fee, so the ceiling is subtotal + deliveryFee, not subtotal alone.
    const discount = money(Math.min(subtotal + deliveryFee, membershipDiscount + voucherDiscount));
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
      await this.promo.redeem(voucherCode, customerId, order.id, subtotal, deliveryFee, authorization);
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
   * Place an order for explicit lines (no cart), for scheduled subscription deliveries
   * (spec 7b). ponytail: the pricing/routing/stock/create block is duplicated from
   * checkout() rather than shared — deliberately, to keep the interactive money-path
   * untouched. Unify into one assembler if a third caller appears. No voucher; no
   * membership discount (a scheduled run carries no customer token → fail-open 0 rate).
   */
  async placeScheduled(
    customerId: string,
    lines: { productId: string; quantity: number }[],
    address: DeliveryAddressSnapshot,
    discountRate = 0,
  ): Promise<OrderRecord> {
    if (lines.length === 0) throw new EmptyCartError();
    const depot = await this.routeDepot(address);
    const prices = depot
      ? await this.depotPricing.getPrices(depot.id, lines.map((l) => l.productId))
      : new Map<string, DepotPrice>();

    const productById = await this.pricedAll(lines.map((l) => l.productId));
    const items: CreateOrderItemData[] = [];
    for (const line of lines) {
      const product = productById.get(line.productId)!;
      const priceRow = prices.get(product.id);
      const base = priceRow?.sellPrice ?? product.basePrice;
      const adj = priceRow?.adjustType
        ? { adjustType: priceRow.adjustType, value: priceRow.value ?? 0 }
        : null;
      const unitPrice = money(applyAdjustment(base, adj));
      items.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        unitPrice,
        quantity: line.quantity,
        lineTotal: money(unitPrice * line.quantity),
      });
    }

    const subtotal = money(items.reduce((sum, i) => sum + i.lineTotal, 0));
    const perUnitFee = depot ? depot.deliveryFee : this.config.deliveryFee;
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
        .notify('REORDER_REMINDER', target.phone, { name: target.recipientName }, target.customerId, '')
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
   * Auto-cancels unconfirmed CREATED orders older than the abandonment threshold,
   * releasing any stock they held. Admin-triggered sweep (mirrors loyalty/expire) —
   * only CREATED orders qualify, so a legitimately in-flight order is never touched.
   */
  async expireAbandoned(
    changedBy: string,
    authorization = '',
    olderThanMinutes?: number,
  ): Promise<{ cancelled: number }> {
    const minutes = olderThanMinutes ?? this.config.abandonMinutes;
    const before = new Date(Date.now() - minutes * 60_000);
    const stale = await this.orders.findStaleCreated(before);
    for (const order of stale) {
      const cancelled = await this.orders.applyStatus(
        order.id,
        OrderStatus.CANCELLED,
        changedBy,
        'Auto-cancelled: order abandoned before confirmation.',
      );
      await this.releaseStock(cancelled, authorization);
    }
    return { cancelled: stale.length };
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
      to === OrderStatus.DRIVER_ASSIGNED ? driverName ?? null : undefined,
      to === OrderStatus.DRIVER_ASSIGNED ? driverPhone ?? null : undefined,
      to === OrderStatus.ON_DELIVERY && estimatedArrivalAt
        ? new Date(estimatedArrivalAt)
        : undefined,
    );
    // Post-completion coordination (both fail-open — a downstream outage never
    // blocks completion, and both are idempotent on the downstream side).
    if (to === OrderStatus.COMPLETED) {
      // BR-013: award loyalty points.
      await this.loyalty.awardPoints(
        updated.customerId,
        updated.id,
        updated.subtotal,
        authorization,
      );
      // Notify the customer of the points they just earned (spec 5h feed). Points mirror
      // loyalty's BR-013 rate (1 pt / Rp 1.000 subtotal); computed here only for the
      // message copy — loyalty-service remains the source of truth for the balance.
      const pointsEarned = pointsForSubtotal(updated.subtotal);
      if (pointsEarned > 0) {
        await this.notification
          .notify(
            'POINTS_EARNED',
            updated.phone,
            { name: updated.recipientName, points: String(pointsEarned), orderNumber: updated.orderNumber },
            updated.customerId,
            authorization,
          )
          .catch(() => {});
      }
      // FR-092: qualify a pending referral for this customer (rewards both parties).
      await this.referral.qualify(updated.customerId, updated.id, authorization);
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
      depotId: input.depotId,
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
