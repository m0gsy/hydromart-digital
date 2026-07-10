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
import { ORDER_TOKENS } from '../tokens';
import { CartService, CartView } from './cart.service';

export interface CheckoutInput {
  deliveryAddress: DeliveryAddressSnapshot;
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
    private readonly cartService: CartService,
    private readonly config: OrderConfigService,
  ) {}

  /**
   * Places an order from the customer's cart. Prices are re-resolved from the
   * catalog (never trusts the client), the delivery address is snapshotted, and
   * the cart is cleared on success.
   */
  async checkout(customerId: string, input: CheckoutInput): Promise<OrderRecord> {
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
    const discount = 0;
    const total = money(subtotal + deliveryFee - discount);

    const order = await this.orders.create({
      orderNumber: OrderService.newOrderNumber(),
      customerId,
      subtotal,
      deliveryFee,
      discount,
      total,
      ...input.deliveryAddress,
      items,
    });
    await this.cart.clear(customerId);
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
  ): Promise<OrderRecord> {
    const order = await this.getAny(orderId);
    if (!canTransition(order.status, to)) {
      throw new InvalidStatusTransitionError(order.status, to);
    }
    return this.orders.applyStatus(order.id, to, changedBy, note ?? null);
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
