import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { OrderConfigService } from '../../src/config/order-config.service';
import { OrderStatus } from '../../src/domain/order-status';
import { CartItemRecord, CartRepository } from '../../src/application/ports/cart.repository';
import {
  CreateOrderData,
  OrderQuery,
  OrderRecord,
  OrderRepository,
} from '../../src/application/ports/order.repository';
import {
  CatalogProduct,
  ProductCatalogPort,
} from '../../src/application/ports/product-catalog.port';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryCartRepository implements CartRepository {
  rows: CartItemRecord[] = [];

  async findByCustomer(customerId: string): Promise<CartItemRecord[]> {
    return this.rows
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async findItem(customerId: string, productId: string): Promise<CartItemRecord | null> {
    return this.rows.find((r) => r.customerId === customerId && r.productId === productId) ?? null;
  }
  async upsert(customerId: string, productId: string, quantity: number): Promise<CartItemRecord> {
    const existing = this.rows.find(
      (r) => r.customerId === customerId && r.productId === productId,
    );
    if (existing) {
      existing.quantity = quantity;
      existing.updatedAt = nextDate();
      return { ...existing };
    }
    const now = nextDate();
    const rec: CartItemRecord = {
      id: randomUUID(),
      customerId,
      productId,
      quantity,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(rec);
    return { ...rec };
  }
  async remove(customerId: string, productId: string): Promise<void> {
    this.rows = this.rows.filter(
      (r) => !(r.customerId === customerId && r.productId === productId),
    );
  }
  async clear(customerId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.customerId !== customerId);
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  rows: OrderRecord[] = [];

  async create(data: CreateOrderData): Promise<OrderRecord> {
    const { items, ...rest } = data;
    const now = nextDate();
    const rec: OrderRecord = {
      ...rest,
      id: randomUUID(),
      status: OrderStatus.CREATED,
      items: items.map((i) => ({ ...i, id: randomUUID() })),
      history: [{ status: OrderStatus.CREATED, changedBy: null, note: null, createdAt: now }],
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(rec);
    return structuredClone(rec);
  }
  async findById(id: string): Promise<OrderRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  }
  async search(query: OrderQuery): Promise<{ items: OrderRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => !query.customerId || r.customerId === query.customerId)
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit).map((r) => structuredClone(r)),
      total: all.length,
    };
  }
  async applyStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
  ): Promise<OrderRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    row.status = status;
    row.updatedAt = nextDate();
    row.history.push({ status, changedBy, note, createdAt: row.updatedAt });
    return structuredClone(row);
  }
}

export class FakeProductCatalog implements ProductCatalogPort {
  products = new Map<string, CatalogProduct>();
  throwOnGet = false;

  seed(product: Partial<CatalogProduct> & { id: string }): CatalogProduct {
    const full: CatalogProduct = {
      name: 'Air Galon 19L',
      sku: 'AIR-19L',
      unit: 'Galon 19L',
      basePrice: 20000,
      active: true,
      ...product,
    };
    this.products.set(full.id, full);
    return full;
  }
  async getProduct(productId: string): Promise<CatalogProduct | null> {
    if (this.throwOnGet) {
      throw new Error('catalog down');
    }
    return this.products.get(productId) ?? null;
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): OrderConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    ORDER_SERVICE_PORT: '3004',
    ORDER_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    PRODUCT_SERVICE_URL: 'http://localhost:3003',
    ORDER_DELIVERY_FEE: '5000',
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
  return new OrderConfigService(fake as unknown as ConfigService);
}
