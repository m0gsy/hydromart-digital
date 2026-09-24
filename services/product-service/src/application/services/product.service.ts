import { Inject, Injectable, Logger } from '@nestjs/common';

import { CategoryNotFoundError, DuplicateSkuError, ProductNotFoundError } from '../../domain/errors';
import { Page, buildPage } from '../pagination';
import { CreateProductData, PriceChangeRecord, ProductRecord, ProductRepository, UpdateProductData } from '../ports/product.repository';
import { CategoryRepository } from '../ports/category.repository';
import { StockNotifierPort } from '../ports/stock-notifier.port';
import { PRODUCT_TOKENS } from '../tokens';
import { assertFresh } from '@hydromart/platform';

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

  /**
   * Audit S-7: one call for a whole cart. Missing or inactive ids are simply absent from
   * the reply — the caller decides what a missing line means (checkout rejects it), and a
   * single bad id must not fail the resolution of every other line.
   */
  async byIds(ids: string[]): Promise<ProductRecord[]> {
    if (ids.length === 0) return [];
    return this.products.findActiveByIds(ids);
  }

  async create(data: CreateProductData): Promise<ProductRecord> {
    if (await this.products.findBySku(data.sku)) {
      throw new DuplicateSkuError();
    }
    await this.assertCategory(data.categoryId);
    return this.products.create(data);
  }

  /**
   * CA-2-53: refused when the caller's copy is older than the stored product — the price on
   * this row is what a customer is charged.
   */
  async update(
    id: string,
    patch: UpdateProductData,
    seenUpdatedAt?: string,
    changedBy?: string,
  ): Promise<ProductRecord> {
    // Destructured, not held as a reference: the values are compared after the write, and
    // a repository that hands back the row it is about to mutate would make every
    // comparison see the new value and never notify.
    const { name, unit, active, updatedAt, basePrice } = await this.get(id, false);
    assertFresh(updatedAt, seenUpdatedAt);
    if (patch.sku) {
      const owner = await this.products.findBySku(patch.sku);
      if (owner && owner.id !== id) {
        throw new DuplicateSkuError();
      }
    }
    if (patch.categoryId !== undefined) {
      await this.assertCategory(patch.categoryId);
    }
    /*
     * PRD-1 — the base price is the number every depot sells from, and it moved without a
     * trace. Owner decision 2026-09-11 left the right to edit the catalog with depot
     * managers; what was missing is the record, so afterwards nobody could say what the
     * price had been, who moved it, or when.
     *
     * Only an actual move is recorded: a PATCH that re-saves the same number, or that does
     * not mention the price at all, is not a price change and must not pad the trail.
     */
    const movesPrice = patch.basePrice !== undefined && patch.basePrice !== basePrice;
    const updated =
      movesPrice && changedBy
        ? await this.products.updateWithPriceAudit(id, patch, {
            changedBy,
            fromPrice: basePrice,
            toPrice: patch.basePrice as number,
          })
        : await this.products.update(id, patch);
    // Only the three fields a depot stock line copied. Editing a price or a photo changes
    // nothing a depot mirrors, and pushing on every edit would make a busy catalog session
    // hammer depot-service for no reason.
    if (updated.name !== name || updated.unit !== unit || updated.active !== active) {
      await this.notifyStock(updated);
    }
    return updated;
  }

  /** PRD-1: the recorded price moves for one product, newest first. */
  async priceHistory(id: string, limit = 50): Promise<PriceChangeRecord[]> {
    await this.get(id, false); // 404 for a product that does not exist
    return this.products.listPriceChanges(id, Math.min(Math.max(limit, 1), 200));
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
