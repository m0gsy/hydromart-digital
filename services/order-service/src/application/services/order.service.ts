import { randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  BelowMinimumOrderError,
  CatalogUnavailableError,
  EmptyCartError,
  InvalidStatusTransitionError,
  OrderNotCancellableError,
  OrderNotFoundError,
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
import { applyAdjustment } from '../../domain/pricing';
import { OrderConfigService } from '../../config/order-config.service';
import { Page, buildPage } from '../pagination';
import { CartRepository } from '../ports/cart.repository';
import {
  CreateOrderItemData,
  DeliveryAddressSnapshot,
  OrderQuery,
  OrderRecord,
  OrderRepository,
} from '../ports/order.repository';
import { ProductCatalogPort } from '../ports/product-catalog.port';
import { DepotDirectoryPort, DepotLocation } from '../ports/depot-directory.port';
import { DepotPrice, DepotPricingPort } from '../ports/depot-pricing.port';
import { LoyaltyCoordinationPort } from '../ports/loyalty-coordination.port';
import { ReferralCoordinationPort } from '../ports/referral-coordination.port';
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
}

export interface ListOrdersInput {
  page?: number;
  limit?: number;
  status?: OrderStatus;
}

/** Rounds to 2 decimals (IDR minor units) to keep money arithmetic exact. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
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

    const items: CreateOrderItemData[] = [];
    for (const line of lines) {
      const product = await this.priced(line.productId);
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
    const deliveryFee = money(depot ? depot.deliveryFee : this.config.deliveryFee);

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
      const quote = await this.promo.quote(voucherCode, customerId, subtotal, authorization);
      voucherDiscount = quote.discount;
    }

    // Membership and voucher discounts stack (BR-015 forbids stacking multiple
    // vouchers, not a voucher with a tier benefit). The combined discount can
    // never exceed the subtotal.
    const discount = money(Math.min(subtotal, membershipDiscount + voucherDiscount));
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
      ...input.deliveryAddress,
      items,
    });
    await this.cart.clear(customerId);

    // Record the redemption now that the order exists. Idempotent per order and
    // fail-open — a failure here never unwinds a placed order.
    if (voucherCode) {
      await this.promo.redeem(voucherCode, customerId, order.id, subtotal, authorization);
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

  async listForCustomer(customerId: string, input: ListOrdersInput): Promise<Page<OrderRecord>> {
    return this.search({ ...input, customerId });
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
  ): Promise<OrderRecord> {
    const order = await this.getAny(orderId);
    if (!canTransition(order.status, to)) {
      throw new InvalidStatusTransitionError(order.status, to);
    }
    const updated = await this.orders.applyStatus(order.id, to, changedBy, note ?? null);
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

  private async priced(productId: string) {
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

  private async search(
    input: ListOrdersInput & { customerId?: string },
  ): Promise<Page<OrderRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(OrderService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const query: OrderQuery = { page, limit, customerId: input.customerId, status: input.status };
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
