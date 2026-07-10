import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { ProductConfigService } from '../../src/config/product-config.service';
import {
  CategoryRecord,
  CategoryRepository,
  CreateCategoryData,
  UpdateCategoryData,
} from '../../src/application/ports/category.repository';
import {
  CreateProductData,
  ProductQuery,
  ProductRecord,
  ProductRepository,
  UpdateProductData,
} from '../../src/application/ports/product.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryCategoryRepository implements CategoryRepository {
  rows: CategoryRecord[] = [];

  async list(activeOnly: boolean): Promise<CategoryRecord[]> {
    return this.rows
      .filter((r) => !activeOnly || r.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async findById(id: string): Promise<CategoryRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findBySlug(slug: string): Promise<CategoryRecord | null> {
    return this.rows.find((r) => r.slug === slug) ?? null;
  }
  async create(data: CreateCategoryData): Promise<CategoryRecord> {
    const now = nextDate();
    const rec: CategoryRecord = { ...data, id: randomUUID(), active: true, createdAt: now, updatedAt: now };
    this.rows.push(rec);
    return { ...rec };
  }
  async update(id: string, patch: UpdateCategoryData): Promise<CategoryRecord> {
    const rec = this.rows.find((r) => r.id === id)!;
    Object.assign(rec, patch, { updatedAt: nextDate() });
    return { ...rec };
  }
}

export class InMemoryProductRepository implements ProductRepository {
  rows: ProductRecord[] = [];

  private match(r: ProductRecord, q: Pick<ProductQuery, 'categoryId' | 'search' | 'activeOnly'>): boolean {
    if (q.activeOnly && !r.active) return false;
    if (q.categoryId && r.categoryId !== q.categoryId) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      if (!r.name.toLowerCase().includes(s) && !r.sku.toLowerCase().includes(s)) return false;
    }
    return true;
  }

  async search(query: ProductQuery): Promise<{ items: ProductRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => this.match(r, query))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.limit;
    return { items: all.slice(start, start + query.limit), total: all.length };
  }
  async findById(id: string, activeOnly: boolean): Promise<ProductRecord | null> {
    return this.rows.find((r) => r.id === id && (!activeOnly || r.active)) ?? null;
  }
  async findBySku(sku: string): Promise<ProductRecord | null> {
    return this.rows.find((r) => r.sku === sku) ?? null;
  }
  async create(data: CreateProductData): Promise<ProductRecord> {
    const now = nextDate();
    const rec: ProductRecord = { ...data, id: randomUUID(), active: true, createdAt: now, updatedAt: now };
    this.rows.push(rec);
    return { ...rec };
  }
  async update(id: string, patch: UpdateProductData): Promise<ProductRecord> {
    const rec = this.rows.find((r) => r.id === id)!;
    Object.assign(rec, patch, { updatedAt: nextDate() });
    return { ...rec };
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): ProductConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    PRODUCT_SERVICE_PORT: '3003',
    PRODUCT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new ProductConfigService(fake as unknown as ConfigService);
}
