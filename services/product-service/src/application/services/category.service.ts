import { Inject, Injectable } from '@nestjs/common';

import { CategoryNotFoundError, DuplicateSlugError } from '../../domain/errors';
import {
  CategoryRecord,
  CategoryRepository,
  CreateCategoryData,
  UpdateCategoryData,
} from '../ports/category.repository';
import { PRODUCT_TOKENS } from '../tokens';
import { ImportSummary, assertFresh, isDecisionOnlyPatch, runImport } from '@hydromart/platform';

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

  /** Bulk category import; an existing slug is skipped, never overwritten. */
  importRows(rows: { name: string; slug: string; sortOrder?: number }[]): Promise<ImportSummary> {
    return runImport(
      rows,
      async (row) => {
        const created = await this.create({
          name: row.name,
          slug: row.slug,
          sortOrder: row.sortOrder ?? 0,
        });
        return { status: 'created', id: created.id };
      },
      (err) => err instanceof DuplicateSlugError,
    );
  }

  /** CA-2-53: refused when the caller's copy is older than the stored category. */
  async update(
    id: string,
    patch: UpdateCategoryData,
    seenUpdatedAt?: string,
  ): Promise<CategoryRecord> {
    const current = await this.getOrThrow(id);
    if (!isDecisionOnlyPatch(patch)) assertFresh(current.updatedAt, seenUpdatedAt);
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
