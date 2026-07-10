import { Inject, Injectable } from '@nestjs/common';

import { CategoryNotFoundError, DuplicateSkuError, ProductNotFoundError } from '../../domain/errors';
import { Page, buildPage } from '../pagination';
import {
  CreateProductData,
  ProductRecord,
  ProductRepository,
  UpdateProductData,
} from '../ports/product.repository';
import { CategoryRepository } from '../ports/category.repository';
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
  ) {}

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
    await this.get(id, false);
    if (patch.sku) {
      const owner = await this.products.findBySku(patch.sku);
      if (owner && owner.id !== id) {
        throw new DuplicateSkuError();
      }
    }
    if (patch.categoryId !== undefined) {
      await this.assertCategory(patch.categoryId);
    }
    return this.products.update(id, patch);
  }

  /** Soft delete. */
  async deactivate(id: string): Promise<ProductRecord> {
    await this.get(id, false);
    return this.products.update(id, { active: false });
  }

  private async assertCategory(categoryId: string | null | undefined): Promise<void> {
    if (categoryId && !(await this.categories.findById(categoryId))) {
      throw new CategoryNotFoundError();
    }
  }
}
