import { Inject, Injectable, Logger } from '@nestjs/common';

import { CategoryNotFoundError, DuplicateSkuError, ProductNotFoundError } from '../../domain/errors';
import { Page, buildPage } from '../pagination';
import {
  CreateProductData,
  ProductRecord,
  ProductRepository,
  UpdateProductData,
} from '../ports/product.repository';
import { CategoryRepository } from '../ports/category.repository';
import { StockNotifierPort } from '../ports/stock-notifier.port';
import { PRODUCT_TOKENS } from '../tokens';

export interface BrowseInput {
  page?: number;
  limit?: number;
  categoryId?: string;
  search?: string;
}

/** Product catalog: public browse (active-only) + admin CRUD. Delete = soft. */
@Injectable()
export class ProductService {
  private static readonly MAX_LIMIT = 100;

  constructor(
    @Inject(PRODUCT_TOKENS.ProductRepository) private readonly products: ProductRepository,
    @Inject(PRODUCT_TOKENS.CategoryRepository) private readonly categories: CategoryRepository,
    @Inject(PRODUCT_TOKENS.StockNotifier) private readonly stockNotifier: StockNotifierPort,
  ) {}

  private readonly logger = new Logger(ProductService.name);

  async browse(input: BrowseInput, activeOnly: boolean): Promise<Page<ProductRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(ProductService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const { items, total } = await this.products.search({
      page,
      limit,
      categoryId: input.categoryId,
      search: input.search?.trim() || undefined,
      activeOnly,
    });
    return buildPage(items, total, page, limit);
  }

  async get(id: string, activeOnly: boolean): Promise<ProductRecord> {
    const product = await this.products.findById(id, activeOnly);
    if (!product) {
      throw new ProductNotFoundError();
    }
    return product;
  }

  async create(data: CreateProductData): Promise<ProductRecord> {
    if (await this.products.findBySku(data.sku)) {
      throw new DuplicateSkuError();
    }
    await this.assertCategory(data.categoryId);
    return this.products.create(data);
  }

  async update(id: string, patch: UpdateProductData): Promise<ProductRecord> {
    // Destructured, not held as a reference: the values are compared after the write, and
    // a repository that hands back the row it is about to mutate would make every
    // comparison see the new value and never notify.
    const { name, unit, active } = await this.get(id, false);
    if (patch.sku) {
      const owner = await this.products.findBySku(patch.sku);
      if (owner && owner.id !== id) {
        throw new DuplicateSkuError();
      }
    }
    if (patch.categoryId !== undefined) {
      await this.assertCategory(patch.categoryId);
    }
    const updated = await this.products.update(id, patch);
    // Only the three fields a depot stock line copied. Editing a price or a photo changes
    // nothing a depot mirrors, and pushing on every edit would make a busy catalog session
    // hammer depot-service for no reason.
    if (updated.name !== name || updated.unit !== unit || updated.active !== active) {
      await this.notifyStock(updated);
    }
    return updated;
  }

  /** Soft delete. */
  async deactivate(id: string): Promise<ProductRecord> {
    await this.get(id, false);
    const updated = await this.products.update(id, { active: false });
    await this.notifyStock(updated);
    return updated;
  }

  /**
   * Best-effort push to depot-service. The port's contract is that it never throws; this
   * catch is the belt to that suspenders, because the catalog write has already committed
   * and must not be reported as failed over a notification.
   */
  private async notifyStock(product: ProductRecord): Promise<void> {
    try {
      await this.stockNotifier.productChanged({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        active: product.active,
      });
    } catch (error) {
      this.logger.warn(`Stock notify for ${product.id} failed: ${(error as Error).message}`);
    }
  }

  private async assertCategory(categoryId: string | null | undefined): Promise<void> {
    if (categoryId && !(await this.categories.findById(categoryId))) {
      throw new CategoryNotFoundError();
    }
  }
}
