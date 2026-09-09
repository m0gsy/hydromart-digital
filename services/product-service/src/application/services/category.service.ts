import { Inject, Injectable } from '@nestjs/common';

import { CategoryNotFoundError, DuplicateSlugError } from '../../domain/errors';
import {
  CategoryRecord,
  CategoryRepository,
  CreateCategoryData,
  UpdateCategoryData,
} from '../ports/category.repository';
import { PRODUCT_TOKENS } from '../tokens';
import { assertFresh } from '@hydromart/platform';

/** Category catalog. Public list is active-only; admin sees all. Delete = soft (active:false). */
@Injectable()
export class CategoryService {
  constructor(
    @Inject(PRODUCT_TOKENS.CategoryRepository) private readonly categories: CategoryRepository,
  ) {}

  list(activeOnly: boolean): Promise<CategoryRecord[]> {
    return this.categories.list(activeOnly);
  }

  async getOrThrow(id: string): Promise<CategoryRecord> {
    const category = await this.categories.findById(id);
    if (!category) {
      throw new CategoryNotFoundError();
    }
    return category;
  }

  async create(data: CreateCategoryData): Promise<CategoryRecord> {
    if (await this.categories.findBySlug(data.slug)) {
      throw new DuplicateSlugError();
    }
    return this.categories.create(data);
  }

  /** CA-2-53: refused when the caller's copy is older than the stored category. */
  async update(
    id: string,
    patch: UpdateCategoryData,
    seenUpdatedAt?: string,
  ): Promise<CategoryRecord> {
    assertFresh((await this.getOrThrow(id)).updatedAt, seenUpdatedAt);
    if (patch.slug) {
      const owner = await this.categories.findBySlug(patch.slug);
      if (owner && owner.id !== id) {
        throw new DuplicateSlugError();
      }
    }
    return this.categories.update(id, patch);
  }

  /** Soft delete. */
  async deactivate(id: string): Promise<CategoryRecord> {
    await this.getOrThrow(id);
    return this.categories.update(id, { active: false });
  }
}
