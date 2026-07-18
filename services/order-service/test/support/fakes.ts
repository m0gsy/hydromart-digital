import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { OrderConfigService } from '../../src/config/order-config.service';
import { OrderStatus } from '../../src/domain/order-status';
import { CartItemRecord, CartRepository } from '../../src/application/ports/cart.repository';
import {
  CreateOrderData,
  CreateReviewData,
  CustomerLifetime,
  CustomerSales,
  DepotSales,
  DepotRating,
  DepotRatingsDetail,
  DepotRefund,
  DepotShipping,
  OrderQuery,
  OrderRecord,
  OrderRepository,
  OrderReviewRecord,
  RatingSummary,
  ProductRevenue,
  ReportRange,
  RetentionCell,
  SalesBucket,
  SegmentConditions,
} from '../../src/application/ports/order.repository';
import {
  CreateSubscriptionData,
  SubscriptionNetworkSummary,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionStatus,
} from '../../src/application/ports/subscription.repository';
import {
  CatalogProduct,
  ProductCatalogPort,
} from '../../src/application/ports/product-catalog.port';
import {
  DepotDirectoryPort,
  DepotLocation,
} from '../../src/application/ports/depot-directory.port';
import { DepotPrice, DepotPricingPort } from '../../src/application/ports/depot-pricing.port';
import { LoyaltyCoordinationPort } from '../../src/application/ports/loyalty-coordination.port';
import { ReferralCoordinationPort } from '../../src/application/ports/referral-coordination.port';
import { RecommendationCoordinationPort } from '../../src/application/ports/recommendation-coordination.port';
import { ForecastCoordinationPort } from '../../src/application/ports/forecast-coordination.port';
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
  reviews: OrderReviewRecord[] = [];
  refunds = new Map<string, number>();

  async findReorderReminderTargets(
    cutoff: Date,
    limit: number,
  ): Promise<{ customerId: string; phone: string; recipientName: string }[]> {
    const latestByCustomer = new Map<string, OrderRecord>();
    for (const r of this.rows) {
      const cur = latestByCustomer.get(r.customerId);
      if (!cur || r.createdAt > cur.createdAt) latestByCustomer.set(r.customerId, r);
    }
    return [...latestByCustomer.values()]
      .filter((r) => r.createdAt < cutoff)
      .slice(0, limit)
      .map((r) => ({ customerId: r.customerId, phone: r.phone, recipientName: r.recipientName }));
  }

  async createReview(data: CreateReviewData): Promise<OrderReviewRecord> {
    const rec: OrderReviewRecord = { ...data, id: randomUUID(), createdAt: nextDate() };
    this.reviews.push(rec);
    const row = this.rows.find((r) => r.id === data.orderId);
    if (row) row.reviewed = true;
    return structuredClone(rec);
  }
  async findReviewByOrderId(orderId: string): Promise<OrderReviewRecord | null> {
    const r = this.reviews.find((x) => x.orderId === orderId);
    return r ? structuredClone(r) : null;
  }
  async avgRatingForOrders(orderIds: string[]): Promise<RatingSummary> {
    const mine = this.reviews.filter((r) => orderIds.includes(r.orderId));
    if (mine.length === 0) return { average: null, count: 0 };
    return {
      average: mine.reduce((s, r) => s + r.rating, 0) / mine.length,
      count: mine.length,
    };
  }

  async create(data: CreateOrderData): Promise<OrderRecord> {
    const { items, ...rest } = data;
    const now = nextDate();
    const rec: OrderRecord = {
      ...rest,
      id: rest.id ?? randomUUID(),
      status: OrderStatus.CREATED,
      items: items.map((i) => ({ ...i, id: randomUUID() })),
      history: [{ status: OrderStatus.CREATED, changedBy: null, note: null, createdAt: now }],
      driverName: null,
      reviewed: false,
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
      .filter((r) => !query.depotId || r.depotId === query.depotId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit).map((r) => structuredClone(r)),
      total: all.length,
    };
  }
  async findStaleCreated(before: Date): Promise<OrderRecord[]> {
    return this.rows
      .filter((r) => r.status === OrderStatus.CREATED && r.createdAt < before)
      .map((r) => structuredClone(r));
  }

  async findCompletedPage(
    cursor: string | null,
    limit: number,
  ): Promise<{ orders: OrderRecord[]; nextCursor: string | null }> {
    const sorted = this.rows
      .filter((r) => r.status === OrderStatus.COMPLETED)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const start = cursor ? Math.max(0, sorted.findIndex((r) => r.id === cursor)) : 0;
    const slice = sorted.slice(start, start + limit + 1);
    const hasMore = slice.length > limit;
    const page = hasMore ? slice.slice(0, limit) : slice;
    return {
      orders: page.map((r) => structuredClone(r)),
      nextCursor: hasMore ? slice[limit].id : null,
    };
  }

  async applyStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
    driverName?: string | null,
  ): Promise<OrderRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    row.status = status;
    if (driverName != null) row.driverName = driverName;
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

  async shippingByDepot(range: ReportRange): Promise<DepotShipping[]> {
    const agg = new Map<string, number>();
    for (const r of this.reportRows(range)) {
      if (!r.depotId) continue;
      agg.set(r.depotId, (agg.get(r.depotId) ?? 0) + r.deliveryFee);
    }
    return [...agg.entries()].map(([depotId, shippingBilled]) => ({ depotId, shippingBilled }));
  }

  async refundsByDepot(range: ReportRange): Promise<DepotRefund[]> {
    // Refunds count regardless of status (a cancelled order is what triggers a refund),
    // windowed on createdAt like the sibling reports.
    const agg = new Map<string, number>();
    for (const r of this.rows) {
      if (range.from && r.createdAt < range.from) continue;
      if (range.to && r.createdAt >= range.to) continue;
      const refunded = this.refunds.get(r.id);
      if (!r.depotId || refunded == null) continue;
      agg.set(r.depotId, (agg.get(r.depotId) ?? 0) + refunded);
    }
    return [...agg.entries()].map(([depotId, refunded]) => ({ depotId, refunded }));
  }

  async recordRefund(orderId: string, amount: number): Promise<void> {
    this.refunds.set(orderId, amount);
  }

  async ratingByDepot(range: ReportRange): Promise<DepotRating[]> {
    const inRange = new Set(this.reportRows(range).map((r) => r.id));
    const byDepot = new Map<string, { sum: number; count: number }>();
    for (const rev of this.reviews) {
      const order = this.rows.find((o) => o.id === rev.orderId);
      if (!order?.depotId || !inRange.has(order.id)) continue;
      const a = byDepot.get(order.depotId) ?? { sum: 0, count: 0 };
      a.sum += rev.rating;
      a.count += 1;
      byDepot.set(order.depotId, a);
    }
    return [...byDepot.entries()].map(([depotId, v]) => ({
      depotId,
      rating: v.sum / v.count,
      reviewCount: v.count,
    }));
  }

  async depotRatings(depotId: string, range: ReportRange): Promise<DepotRatingsDetail> {
    const inWindow = (o: OrderRecord): boolean =>
      o.depotId === depotId &&
      (!range.from || o.createdAt >= range.from) &&
      (!range.to || o.createdAt < range.to);
    const joined = this.reviews
      .map((rev) => ({ rev, order: this.rows.find((o) => o.id === rev.orderId) }))
      .filter(
        (x): x is { rev: OrderReviewRecord; order: OrderRecord } => !!x.order && inWindow(x.order),
      );
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let sum = 0;
    for (const { rev } of joined) {
      const star = String(rev.rating) as keyof typeof distribution;
      if (star in distribution) distribution[star] += 1;
      sum += rev.rating;
    }
    const count = joined.length;
    const recent = [...joined]
      .sort((a, b) => b.rev.createdAt.getTime() - a.rev.createdAt.getTime())
      .slice(0, 8)
      .map(({ rev, order }) => ({
        customerName: order.recipientName,
        stars: rev.rating,
        comment: rev.comment,
        createdAt: rev.createdAt,
      }));
    return { average: count === 0 ? null : sum / count, count, distribution, recent };
  }

  async revenueByProduct(range: ReportRange, limit: number): Promise<ProductRevenue[]> {
    const agg = new Map<string, ProductRevenue>();
    for (const r of this.reportRows(range)) {
      for (const i of r.items) {
        const cur = agg.get(i.productId) ?? {
          productId: i.productId,
          productName: i.productName,
          orderCount: 0,
          revenue: 0,
        };
        cur.orderCount += 1;
        cur.revenue += i.lineTotal;
        agg.set(i.productId, cur);
      }
    }
    return [...agg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  }

  async retentionCohort(range: ReportRange): Promise<RetentionCell[]> {
    const monthKey = (d: Date) => d.toISOString().slice(0, 7);
    const monthIdx = (cohort: string, active: string) => {
      const [cy, cm] = cohort.split('-').map(Number);
      const [ay, am] = active.split('-').map(Number);
      return (ay - cy) * 12 + (am - cm);
    };
    const rows = this.reportRows(range);
    const cohortOf = new Map<string, string>();
    for (const r of rows) {
      const m = monthKey(r.createdAt);
      const cur = cohortOf.get(r.customerId);
      if (!cur || m < cur) cohortOf.set(r.customerId, m);
    }
    // (cohort, monthIndex) -> set of customerIds active that month
    const cells = new Map<string, Set<string>>();
    for (const r of rows) {
      const cohort = cohortOf.get(r.customerId)!;
      const idx = monthIdx(cohort, monthKey(r.createdAt));
      const key = `${cohort}#${idx}`;
      const set = cells.get(key) ?? new Set<string>();
      set.add(r.customerId);
      cells.set(key, set);
    }
    return [...cells.entries()]
      .map(([key, set]) => {
        const [cohort, idx] = key.split('#');
        return { cohort, monthIndex: Number(idx), customers: set.size };
      })
      .sort((a, b) => a.cohort.localeCompare(b.cohort) || a.monthIndex - b.monthIndex);
  }

  async customerLifetime(customerId: string): Promise<CustomerLifetime> {
    const rows = this.rows
      .filter((r) => r.customerId === customerId && r.status !== OrderStatus.CANCELLED)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return {
      orderCount: rows.length,
      revenue: rows.reduce((s, r) => s + r.total, 0),
      firstOrderAt: rows[0]?.createdAt ?? null,
      lastOrderAt: rows[rows.length - 1]?.createdAt ?? null,
    };
  }

  async audienceReach(depotId?: string): Promise<number> {
    const ids = new Set(
      this.rows
        .filter((r) => r.status !== OrderStatus.CANCELLED)
        .filter((r) => !depotId || r.depotId === depotId)
        .map((r) => r.customerId),
    );
    return ids.size;
  }

  async ordersForDepot(depotId: string, range: ReportRange): Promise<OrderRecord[]> {
    return this.rows
      .filter((r) => r.depotId === depotId)
      .filter((r) => !range.from || r.createdAt >= range.from)
      .filter((r) => !range.to || r.createdAt < range.to)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => structuredClone(r));
  }

  async segmentEstimate(conditions: SegmentConditions): Promise<number> {
    const byCustomer = new Map<string, { count: number; first: Date; last: Date }>();
    for (const r of this.rows) {
      if (r.status === OrderStatus.CANCELLED) continue;
      if (conditions.depotId && r.depotId !== conditions.depotId) continue;
      const cur = byCustomer.get(r.customerId) ?? { count: 0, first: r.createdAt, last: r.createdAt };
      cur.count += 1;
      if (r.createdAt > cur.last) cur.last = r.createdAt;
      if (r.createdAt < cur.first) cur.first = r.createdAt;
      byCustomer.set(r.customerId, cur);
    }
    let n = 0;
    for (const agg of byCustomer.values()) {
      if (conditions.minOrders != null && agg.count < conditions.minOrders) continue;
      if (conditions.recencyCutoff && agg.last < conditions.recencyCutoff) continue;
      if (conditions.lapsedCutoff && agg.last >= conditions.lapsedCutoff) continue;
      if (conditions.firstOrderCutoff && agg.first < conditions.firstOrderCutoff) continue;
      n += 1;
    }
    return n;
  }
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  rows: SubscriptionRecord[] = [];

  async create(data: CreateSubscriptionData): Promise<SubscriptionRecord> {
    const now = nextDate();
    const rec: SubscriptionRecord = { ...data, id: randomUUID(), status: 'ACTIVE', createdAt: now, updatedAt: now };
    this.rows.push(rec);
    return structuredClone(rec);
  }
  async findById(id: string): Promise<SubscriptionRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async listByCustomer(customerId: string): Promise<SubscriptionRecord[]> {
    return this.rows.filter((r) => r.customerId === customerId).map((r) => structuredClone(r));
  }
  async findDue(now: Date): Promise<SubscriptionRecord[]> {
    return this.rows
      .filter((r) => r.status === 'ACTIVE' && r.nextDeliveryAt.getTime() <= now.getTime())
      .map((r) => structuredClone(r));
  }
  async setStatus(id: string, status: SubscriptionStatus): Promise<SubscriptionRecord> {
    const r = this.rows.find((x) => x.id === id)!;
    r.status = status;
    r.updatedAt = nextDate();
    return structuredClone(r);
  }
  async advance(id: string, nextDeliveryAt: Date): Promise<SubscriptionRecord> {
    const r = this.rows.find((x) => x.id === id)!;
    r.nextDeliveryAt = nextDeliveryAt;
    r.updatedAt = nextDate();
    return structuredClone(r);
  }

  async networkSummary(): Promise<SubscriptionNetworkSummary> {
    const active = this.rows.filter((r) => r.status === 'ACTIVE');
    const agg = new Map<string, SubscriptionNetworkSummary['plans'][number]>();
    for (const r of active) {
      const key = `${r.productName}#${r.frequency}`;
      const cur = agg.get(key) ?? {
        productName: r.productName,
        frequency: r.frequency,
        subscribers: 0,
      };
      cur.subscribers += 1;
      agg.set(key, cur);
    }
    return {
      activeSubscriptions: active.length,
      activeSubscribers: new Set(active.map((r) => r.customerId)).size,
      plans: [...agg.values()].sort((a, b) => b.subscribers - a.subscribers),
    };
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

export class FakeDepotPricing implements DepotPricingPort {
  /** depotId -> (productId -> resolved price). Empty = every line uses catalog base. */
  overrides = new Map<string, Map<string, DepotPrice>>();
  /** Records the last lookup so tests can assert it was (not) called. */
  calls: { depotId: string; productIds: string[] }[] = [];

  private forDepot(depotId: string): Map<string, DepotPrice> {
    let m = this.overrides.get(depotId);
    if (!m) {
      m = new Map<string, DepotPrice>();
      this.overrides.set(depotId, m);
    }
    return m;
  }

  setPrice(depotId: string, productId: string, sellPrice: number): void {
    const row = this.forDepot(depotId).get(productId) ?? {};
    this.forDepot(depotId).set(productId, { ...row, sellPrice });
  }

  setRule(depotId: string, productId: string, adjustType: 'PERCENT' | 'FIXED', value: number): void {
    const row = this.forDepot(depotId).get(productId) ?? {};
    this.forDepot(depotId).set(productId, { ...row, adjustType, value });
  }

  async getPrices(depotId: string, productIds: string[]): Promise<Map<string, DepotPrice>> {
    this.calls.push({ depotId, productIds });
    const forDepot = this.overrides.get(depotId) ?? new Map<string, DepotPrice>();
    const result = new Map<string, DepotPrice>();
    for (const id of productIds) {
      const row = forDepot.get(id);
      if (row) result.set(id, row);
    }
    return result;
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

export class FakeRecommendationCoordination implements RecommendationCoordinationPort {
  calls: {
    orderId: string;
    customerId: string;
    depotId: string | null;
    items: { productId: string; productName: string; sku: string; unit: string }[];
  }[] = [];
  async recordCompleted(order: OrderRecord): Promise<void> {
    this.calls.push({
      orderId: order.id,
      customerId: order.customerId,
      depotId: order.depotId,
      items: order.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        unit: i.unit,
      })),
    });
  }
}

export class FakeForecastCoordination implements ForecastCoordinationPort {
  calls: {
    orderId: string;
    customerId: string;
    depotId: string | null;
    total: number;
    items: { productId: string; productName: string; sku: string; unit: string; quantity: number }[];
  }[] = [];
  async ingestCompletedOrder(order: OrderRecord): Promise<void> {
    this.calls.push({
      orderId: order.id,
      customerId: order.customerId,
      depotId: order.depotId,
      total: Math.round(order.total),
      items: order.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        unit: i.unit,
        quantity: i.quantity,
      })),
    });
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
  quoteCalls: { code: string; subtotal: number; shippingFee: number }[] = [];
  redeemCalls: { code: string; orderId: string; subtotal: number; shippingFee: number }[] = [];

  async quote(
    code: string,
    _customerId: string,
    subtotal: number,
    shippingFee: number,
    _authorization: string,
  ): Promise<{ discount: number }> {
    if (this.rejectQuote) throw new VoucherRejectedError('Minimum spend not met.');
    this.quoteCalls.push({ code, subtotal, shippingFee });
    return { discount: this.quoteDiscount };
  }
  async redeem(
    code: string,
    _customerId: string,
    orderId: string,
    subtotal: number,
    shippingFee: number,
    _authorization: string,
  ): Promise<void> {
    this.redeemCalls.push({ code, orderId, subtotal, shippingFee });
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
