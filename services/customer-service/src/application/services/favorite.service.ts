import { Inject, Injectable } from '@nestjs/common';

import { FavoriteRepository } from '../ports/favorite.repository';
import { CUSTOMER_TOKENS } from '../tokens';

/**
 * Product wishlist. Every operation is scoped to the caller's customerId (no
 * cross-tenant access). Add and remove are both idempotent.
 */
@Injectable()
export class FavoriteService {
  constructor(
    @Inject(CUSTOMER_TOKENS.FavoriteRepository) private readonly favorites: FavoriteRepository,
  ) {}

  list(customerId: string): Promise<string[]> {
    return this.favorites.listProductIds(customerId);
  }

  async add(customerId: string, productId: string): Promise<string[]> {
    await this.favorites.add(customerId, productId);
    return this.favorites.listProductIds(customerId);
  }

  async remove(customerId: string, productId: string): Promise<void> {
    await this.favorites.remove(customerId, productId);
  }
}
