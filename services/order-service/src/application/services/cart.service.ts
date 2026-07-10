import { Inject, Injectable } from '@nestjs/common';

import { ProductUnavailableError } from '../../domain/errors';
import { CartItemRecord, CartRepository } from '../ports/cart.repository';
import { CatalogProduct, ProductCatalogPort } from '../ports/product-catalog.port';
import { ORDER_TOKENS } from '../tokens';

/** A cart line enriched with live catalog data for display. */
export interface CartLineView {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface CartView {
  items: CartLineView[];
  subtotal: number;
}

/**
 * Manages a customer's active cart. Quantities are validated but pricing shown
 * here is advisory — the authoritative price is re-resolved at checkout.
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(ORDER_TOKENS.CartRepository) private readonly cart: CartRepository,
    @Inject(ORDER_TOKENS.ProductCatalog) private readonly catalog: ProductCatalogPort,
  ) {}

  /** Add `quantity` to the line, or set it when `absolute` is true. */
  async setItem(
    customerId: string,
    productId: string,
    quantity: number,
    absolute: boolean,
  ): Promise<CartView> {
    const product = await this.catalog.getProduct(productId);
    if (!product || !product.active) {
      throw new ProductUnavailableError(productId);
    }
    const existing = absolute ? null : await this.cart.findItem(customerId, productId);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    await this.cart.upsert(customerId, productId, nextQuantity);
    return this.view(customerId);
  }

  async removeItem(customerId: string, productId: string): Promise<CartView> {
    await this.cart.remove(customerId, productId);
    return this.view(customerId);
  }

  async clear(customerId: string): Promise<void> {
    await this.cart.clear(customerId);
  }

  async view(customerId: string): Promise<CartView> {
    const rows = await this.cart.findByCustomer(customerId);
    const products = await this.resolveAll(rows);
    const items: CartLineView[] = [];
    for (const row of rows) {
      const product = products.get(row.productId);
      if (!product || !product.active) {
        // Stale line (product delisted) — surfaced as unavailable rather than priced.
        continue;
      }
      items.push({
        productId: row.productId,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        unitPrice: product.basePrice,
        quantity: row.quantity,
        lineTotal: product.basePrice * row.quantity,
      });
    }
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    return { items, subtotal };
  }

  private async resolveAll(rows: CartItemRecord[]): Promise<Map<string, CatalogProduct>> {
    const entries = await Promise.all(
      rows.map(async (r) => [r.productId, await this.catalog.getProduct(r.productId)] as const),
    );
    const map = new Map<string, CatalogProduct>();
    for (const [id, product] of entries) {
      if (product) {
        map.set(id, product);
      }
    }
    return map;
  }
}
