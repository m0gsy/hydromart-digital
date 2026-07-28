import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { FavoriteRepository } from '../ports/favorite.repository';
import { ProductCatalogPort } from '../ports/product-catalog.port';
import { CUSTOMER_TOKENS } from '../tokens';

/**
 * Product wishlist. Every operation is scoped to the caller's customerId (no
 * cross-tenant access). Add and remove are both idempotent.
 */
@Injectable()
export class FavoriteService {
  constructor(
    @Inject(CUSTOMER_TOKENS.FavoriteRepository) private readonly favorites: FavoriteRepository,
    @Inject(CUSTOMER_TOKENS.ProductCatalogPort) private readonly catalog: ProductCatalogPort,
  ) {}

  list(customerId: string): Promise<string[]> {
    return this.favorites.listProductIds(customerId);
  }

  async add(customerId: string, productId: string): Promise<string[]> {
    // Reject an id the catalog doesn't know: an unknown favourite renders as a blank row
    // forever and quietly pollutes the recommendation signal. Fails OPEN on a catalog
    // outage — see ProductCatalogPort.
    if (!(await this.catalog.exists(productId))) {
      throw new NotFoundException('Produk tidak ditemukan.');
    }
    await this.favorites.add(customerId, productId);
    return this.favorites.listProductIds(customerId);
  }

  async remove(customerId: string, productId: string): Promise<void> {
    await this.favorites.remove(customerId, productId);
  }
}
