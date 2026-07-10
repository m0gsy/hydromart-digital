import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { OrderConfigService } from '../../src/config/order-config.service';
import { OrderStatus } from '../../src/domain/order-status';
import { CartItemRecord, CartRepository } from '../../src/application/ports/cart.repository';
import {
  CreateOrderData,
  CustomerSales,
  DepotSales,
  OrderQuery,
  OrderRecord,
  OrderRepository,
  ReportRange,
  SalesBucket,
} from '../../src/application/ports/order.repository';
import {
  CatalogProduct,
  ProductCatalogPort,
} from '../../src/application/ports/product-catalog.port';
import {
  DepotDirectoryPort,
  DepotLocation,
} from '../../src/application/ports/depot-directory.port';
import { LoyaltyCoordinationPort } from '../../src/application/ports/loyalty-coordination.port';
import { ReferralCoordinationPort } from '../../src/application/ports/referral-coordination.port';
import { MembershipPort } from '../../src/application/ports/membership.port';
import { NotificationPort } from '../../src/application/ports/notification.port';
import { PromoPort } from '../../src/application/ports/promo.port';
import { InventoryPort, SoldLine } from '../../src/application/ports/inventory.port';
import { VoucherRejectedError } from '../../src/domain/errors';

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
      id: rest.id ?? randomUUID(),
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

  private reportRows(range: ReportRange): OrderRecord[] {
    return this.rows
      .filter((r) => r.status !== OrderStatus.CANCELLED)
      .filter((r) => !range.from || r.createdAt >= range.from)
      .filter((r) => !range.to || r.createdAt < range.to);
  }

  async salesSeries(
    granularity: 'daily' | 'monthly',
    range: ReportRange,
  ): Promise<SalesBucket[]> {
    const buckets = new Map<string, { orderCount: number; revenue: number }>();
    for (const r of this.reportRows(range)) {
      const iso = r.createdAt.toISOString();
      const period = granularity === 'monthly' ? iso.slice(0, 7) : iso.slice(0, 10);
      const b = buckets.get(period) ?? { orderCount: 0, revenue: 0 };
      b.orderCount += 1;
      b.revenue += r.total;
      buckets.set(period, b);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, v]) => ({ period, ...v }));
  }

  async topCustomers(range: ReportRange, limit: number): Promise<CustomerSales[]> {
    const agg = new Map<string, { orderCount: number; revenue: number }>();
    for (const r of this.reportRows(range)) {
      const a = agg.get(r.customerId) ?? { orderCount: 0, revenue: 0 };
      a.orderCount += 1;
      a.revenue += r.total;
      agg.set(r.customerId, a);
    }
    return [...agg.entries()]
      .map(([customerId, v]) => ({ customerId, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  async topDepots(range: ReportRange, limit: number): Promise<DepotSales[]> {
    const agg = new Map<string, { orderCount: number; revenue: number }>();
    for (const r of this.reportRows(range)) {
      if (!r.depotId) continue;
      const a = agg.get(r.depotId) ?? { orderCount: 0, revenue: 0 };
      a.orderCount += 1;
      a.revenue += r.total;
      agg.set(r.depotId, a);
    }
    return [...agg.entries()]
      .map(([depotId, v]) => ({ depotId, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }
}

export class FakeDepotDirectory implements DepotDirectoryPort {
  depots: DepotLocation[] = [];
  /** Simulate the directory being unreachable (fail-open null), not just empty. */
  unreachable = false;
  async listActiveDepots(): Promise<DepotLocation[] | null> {
    return this.unreachable ? null : this.depots.map((d) => ({ ...d }));
  }
}

export interface AwardCall {
  customerId: string;
  orderId: string;
  subtotal: number;
  authorization: string;
}

export class FakeLoyaltyCoordination implements LoyaltyCoordinationPort {
  calls: AwardCall[] = [];
  async awardPoints(
    customerId: string,
    orderId: string,
    subtotal: number,
    authorization: string,
  ): Promise<void> {
    this.calls.push({ customerId, orderId, subtotal, authorization });
  }
}

export class FakeReferralCoordination implements ReferralCoordinationPort {
  calls: { customerId: string; orderId: string; authorization: string }[] = [];
  async qualify(customerId: string, orderId: string, authorization: string): Promise<void> {
    this.calls.push({ customerId, orderId, authorization });
  }
}

export class FakeInventory implements InventoryPort {
  calls: { depotId: string; orderId: string; items: SoldLine[]; authorization: string }[] = [];
  reserveCalls: { depotId: string; orderId: string; items: SoldLine[]; authorization: string }[] = [];
  releaseCalls: { depotId: string; orderId: string; items: SoldLine[]; authorization: string }[] = [];
  /** When set, reserve() throws it (simulates a stock shortfall reject). */
  reserveError: Error | null = null;
  async consume(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void> {
    this.calls.push({ depotId, orderId, items, authorization });
  }
  async reserve(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void> {
    if (this.reserveError) {
      throw this.reserveError;
    }
    this.reserveCalls.push({ depotId, orderId, items, authorization });
  }
  async release(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void> {
    this.releaseCalls.push({ depotId, orderId, items, authorization });
  }
}

export class FakeMembership implements MembershipPort {
  rate = 0;
  async getDiscountRate(_authorization: string): Promise<number> {
    return this.rate;
  }
}

export class FakeNotification implements NotificationPort {
  calls: {
    event: string;
    phone: string;
    vars: Record<string, string>;
    customerId: string;
    authorization: string;
  }[] = [];
  async notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    customerId: string,
    authorization: string,
  ): Promise<void> {
    this.calls.push({ event, phone, vars, customerId, authorization });
  }
}

export class FakePromo implements PromoPort {
  quoteDiscount = 0;
  rejectQuote = false;
  redeemCalls: { code: string; orderId: string; subtotal: number }[] = [];

  async quote(
    _code: string,
    _customerId: string,
    _subtotal: number,
    _authorization: string,
  ): Promise<{ discount: number }> {
    if (this.rejectQuote) throw new VoucherRejectedError('Minimum spend not met.');
    return { discount: this.quoteDiscount };
  }
  async redeem(
    code: string,
    _customerId: string,
    orderId: string,
    subtotal: number,
    _authorization: string,
  ): Promise<void> {
    this.redeemCalls.push({ code, orderId, subtotal });
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
    DEPOT_SERVICE_URL: 'http://localhost:3007',
    LOYALTY_SERVICE_URL: 'http://localhost:3009',
    PROMO_SERVICE_URL: 'http://localhost:3010',
    REFERRAL_SERVICE_URL: 'http://localhost:3011',
    CRM_SERVICE_URL: 'http://localhost:3012',
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
