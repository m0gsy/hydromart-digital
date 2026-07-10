import { randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  CatalogUnavailableError,
  EmptyCartError,
  InvalidStatusTransitionError,
  OrderNotCancellableError,
  OrderNotFoundError,
  ProductUnavailableError,
} from '../../domain/errors';
import { OrderStatus, canTransition, isCancellable } from '../../domain/order-status';
import { selectNearestDepot } from '../../domain/geo';
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
import { DepotDirectoryPort } from '../ports/depot-directory.port';
import { LoyaltyCoordinationPort } from '../ports/loyalty-coordination.port';
import { ReferralCoordinationPort } from '../ports/referral-coordination.port';
import { MembershipPort } from '../ports/membership.port';
import { PromoPort } from '../ports/promo.port';
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
    @Inject(ORDER_TOKENS.LoyaltyCoordination)
    private readonly loyalty: LoyaltyCoordinationPort,
    @Inject(ORDER_TOKENS.ReferralCoordination)
    private readonly referral: ReferralCoordinationPort,
    @Inject(ORDER_TOKENS.Membership) private readonly membership: MembershipPort,
    @Inject(ORDER_TOKENS.Promo) private readonly promo: PromoPort,
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

    const items: CreateOrderItemData[] = [];
    for (const line of lines) {
      const product = await this.priced(line.productId);
      const unitPrice = money(product.basePrice);
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
    const deliveryFee = money(this.config.deliveryFee);

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
    const depotId = await this.routeDepot(input.deliveryAddress);

    const order = await this.orders.create({
      orderNumber: OrderService.newOrderNumber(),
      customerId,
      depotId,
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
  async cancel(customerId: string, orderId: string, reason?: string): Promise<OrderRecord> {
    const order = await this.getForCustomer(customerId, orderId);
    if (!isCancellable(order.status)) {
      throw new OrderNotCancellableError(order.status);
    }
    return this.orders.applyStatus(order.id, OrderStatus.CANCELLED, customerId, reason ?? null);
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
    }
    return updated;
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
   * within its service radius). Advisory only: needs coordinates, and the depot
   * directory fails open, so an unresolved address simply yields a null depot.
   */
  private async routeDepot(address: DeliveryAddressSnapshot): Promise<string | null> {
    if (address.latitude === null || address.longitude === null) {
      return null;
    }
    const depots = await this.depotDirectory.listActiveDepots();
    return selectNearestDepot(address.latitude, address.longitude, depots);
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
