import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { SettingRow, SettingsCache, localDayKey } from '@hydromart/platform';

import { OrderConfigService } from '../../src/config/order-config.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';
import { OrderStatus } from '../../src/domain/order-status';
import { CartItemRecord, CartRepository } from '../../src/application/ports/cart.repository';
import {
  CreateOrderData,
  CreateReviewData,
  CustomerLifetime,
  DepotCustomerAggregate,
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
  OrderValue,
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
  DepotContact,
  DepotDirectoryPort,
  DepotLocation,
  DepotOwnership,
} from '../../src/application/ports/depot-directory.port';
import {
  FranchiseRevenuePort,
  OrderRevenueEvent,
} from '../../src/application/ports/franchise-revenue.port';
import { DepotPrice, DepotPricingPort } from '../../src/application/ports/depot-pricing.port';
import { CashierShiftPort } from '../../src/application/ports/cashier-shift.port';
import { PaymentReversalPort } from '../../src/application/ports/payment-reversal.port';
import { LoyaltyCoordinationPort } from '../../src/application/ports/loyalty-coordination.port';
import { ReferralCoordinationPort } from '../../src/application/ports/referral-coordination.port';
import { RecommendationCoordinationPort } from '../../src/application/ports/recommendation-coordination.port';
import { ForecastCoordinationPort } from '../../src/application/ports/forecast-coordination.port';
import { MembershipPort } from '../../src/application/ports/membership.port';
import {
  ResellerDiscount,
  ResellerDiscountPort,
} from '../../src/application/ports/reseller-discount.port';
import { CustomerDirectoryPort } from '../../src/application/ports/customer-directory.port';
import { NotificationPort } from '../../src/application/ports/notification.port';
import { PromoPort } from '../../src/application/ports/promo.port';
import { InventoryPort, SoldLine } from '../../src/application/ports/inventory.port';
import {
  OutboxMessageRecord,
  OutboxRepository,
  OutboxStatus,
  OutboxWrite,
} from '../../src/application/ports/outbox.repository';
import { OutboxService } from '../../src/application/services/outbox.service';
import {
  DuplicateCheckoutError,
  OrderAlreadyVoidedError,
  StaleOrderStatusError,
  VoucherRejectedError,
} from '../../src/domain/errors';

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
  /**
   * The outbox the real repository writes to in the SAME transaction as the order (H-10).
   * Wired in by the tests so an order can never appear here without its effects being owed.
   */
  outbox: InMemoryOutboxRepository | null = null;
  reviews: OrderReviewRecord[] = [];
  refunds = new Map<string, number>();
  /** Stands in for the `orders_customerId_idempotencyKey_key` unique index: `cust\0key` -> orderId. */
  private readonly byIdempotencyKey = new Map<string, string>();

  /** Mirrors the Postgres sequence: strictly increasing, never repeated (H-12). */
  private orderSeq = 1_000_000;

  async nextOrderSequence(): Promise<number> {
    this.orderSeq += 1;
    return this.orderSeq;
  }

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
    // `outbox` is consumed below and must not land on the record — the real repository
    // destructures it out the same way.
    const { items, outbox, ...rest } = data;
    const now = nextDate();
    const opening = rest.status ?? OrderStatus.CREATED;
    // The unique index is the whole of B-13's in-flight guard, so the fake has to have it
    // too — without this the concurrency test would pass against a repository that lets
    // both writes through, which is exactly the bug.
    const dupeKey = rest.idempotencyKey ? `${rest.customerId}\0${rest.idempotencyKey}` : null;
    if (dupeKey && this.byIdempotencyKey.has(dupeKey)) {
      throw new DuplicateCheckoutError();
    }
    const rec: OrderRecord = {
      ...rest,
      id: rest.id ?? randomUUID(),
      status: opening,
      items: items.map((i) => ({ ...i, id: randomUUID() })),
      history: [{ status: opening, changedBy: null, note: null, createdAt: now }],
      deliveryWindow: rest.deliveryWindow ?? null,
      isWalkIn: rest.isWalkIn ?? false,
      driverName: null,
      driverPhone: null,
      estimatedArrivalAt: null,
      reviewed: false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(rec);
    if (dupeKey) this.byIdempotencyKey.set(dupeKey, rec.id);
    if (outbox?.length) {
      this.outbox?.enqueue(outbox.map((m) => ({ ...m, orderId: rec.id })));
    }
    return structuredClone(rec);
  }
  async findById(id: string): Promise<OrderRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  }
  async findByIdempotencyKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<OrderRecord | null> {
    const id = this.byIdempotencyKey.get(`${customerId}\0${idempotencyKey}`);
    return id ? this.findById(id) : null;
  }
  async assignDepot(id: string, depotId: string): Promise<OrderRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    row.depotId = depotId;
    return structuredClone(row);
  }
  async findOrderValues(orderIds: string[]): Promise<OrderValue[]> {
    return this.rows
      .filter((row) => orderIds.includes(row.id))
      .map((row) => ({ orderId: row.id, orderNumber: row.orderNumber, totalIdr: row.total }));
  }
  async sumDepotSales(depotId: string, from: Date, to: Date): Promise<number> {
    return this.rows
      .filter(
        (r) => r.depotId === depotId && (r.status === 'DELIVERED' || r.status === 'COMPLETED'),
      )
      .filter((r) => r.createdAt >= from && r.createdAt <= to)
      .reduce((t, r) => t + Math.round(r.total), 0);
  }
  async depotDailyGallons(
    depotId: string,
    from: Date,
    to: Date,
    tz: string,
  ): Promise<{ day: string; gallons: number }[]> {
    const byDay = new Map<string, number>();
    for (const r of this.rows) {
      if (r.depotId !== depotId) continue;
      if (r.status !== 'DELIVERED' && r.status !== 'COMPLETED') continue;
      if (r.createdAt < from || r.createdAt >= to) continue;
      const gallons = r.items.reduce((s, i) => s + (i.isGallon ? i.quantity : 0), 0);
      if (gallons === 0) continue;
      const day = localDayKey(r.createdAt, tz);
      byDay.set(day, (byDay.get(day) ?? 0) + gallons);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, gallons]) => ({ day, gallons }));
  }
  async search(
    query: OrderQuery,
  ): Promise<{ items: OrderRecord[]; total: number; nextCursor: string | null }> {
    const all = this.rows
      .filter((r) => !query.customerId || r.customerId === query.customerId)
      .filter((r) => !query.status || r.status === query.status)
      .filter((r) => (query.unrouted ? r.depotId == null : true))
      // Models the repository's orderNumber predicate, so a search test cannot pass
      // against a repository that ignores the term (audit F-12).
      .filter((r) =>
        query.orderNumber
          ? r.orderNumber.toLowerCase().includes(query.orderNumber.trim().toLowerCase())
          : true,
      )
      .filter(
        (r) =>
          query.unrouted ||
          !query.depotIds ||
          (r.depotId != null && query.depotIds.includes(r.depotId)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // Models the real repository: a cursor seeks past that row and ignores `page`.
    const start = query.cursor
      ? all.findIndex((r) => r.id === query.cursor) + 1
      : (query.page - 1) * query.limit;
    const items = all.slice(start, start + query.limit);
    return {
      items: items.map((r) => structuredClone(r)),
      total: all.length,
      nextCursor: items.length === query.limit ? (items[items.length - 1]?.id ?? null) : null,
    };
  }
  async findStaleIn(
    statuses: OrderStatus[],
    before: Date,
    limit = 500,
  ): Promise<OrderRecord[]> {
    // Models the real repository: oldest first, capped — a test that sweeps a backlog
    // has to see the same batching production does.
    return this.rows
      .filter((r) => statuses.includes(r.status) && r.createdAt < before)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  async findCompletedPage(
    cursor: string | null,
    limit: number,
  ): Promise<{ orders: OrderRecord[]; nextCursor: string | null }> {
    const sorted = this.rows
      .filter((r) => r.status === OrderStatus.COMPLETED)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const start = cursor
      ? Math.max(
          0,
          sorted.findIndex((r) => r.id === cursor),
        )
      : 0;
    const slice = sorted.slice(start, start + limit + 1);
    const hasMore = slice.length > limit;
    const page = hasMore ? slice.slice(0, limit) : slice;
    return {
      orders: page.map((r) => structuredClone(r)),
      nextCursor: hasMore ? slice[limit].id : null,
    };
  }

  /** History rows written without a transition (catalog-pricing marker, design 4b). */
  notes: { id: string; status: OrderStatus; changedBy: string; note: string }[] = [];

  async appendNote(id: string, status: OrderStatus, changedBy: string, note: string): Promise<void> {
    this.notes.push({ id, status, changedBy, note });
  }

  async applyStatus(
    id: string,
    from: OrderStatus,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
    driverName?: string | null,
    driverPhone?: string | null,
    estimatedArrivalAt?: Date | null,
    outbox: OutboxWrite[] = [],
  ): Promise<OrderRecord> {
    // The compare-and-set the real repository does in its WHERE (H-4): a caller writing
    // from a status the order has already left claims nothing.
    const row = this.rows.find((r) => r.id === id && r.status === from);
    if (!row) throw new StaleOrderStatusError();
    // Same transaction as the status change (H-10): only the winner writes, so only the
    // winner owes.
    if (outbox.length) this.outbox?.enqueue(outbox);
    row.status = status;
    if (driverName != null) row.driverName = driverName;
    if (driverPhone != null) row.driverPhone = driverPhone;
    if (estimatedArrivalAt != null) row.estimatedArrivalAt = estimatedArrivalAt;
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

  async salesSeries(granularity: 'daily' | 'monthly', range: ReportRange): Promise<SalesBucket[]> {
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

  async voidWalkIn(
    id: string,
    reason: string,
    changedBy: string,
    at: Date,
  ): Promise<OrderRecord> {
    const row = this.rows.find((r) => r.id === id);
    // Mirrors the guarded UPDATE: only a COMPLETED counter sale flips, so a second void
    // finds nothing to change and is rejected exactly as it is against Postgres.
    if (!row || row.status !== OrderStatus.COMPLETED || !row.isWalkIn) {
      throw new OrderAlreadyVoidedError();
    }
    row.status = OrderStatus.VOIDED;
    row.history.push({ status: OrderStatus.VOIDED, changedBy, note: reason, createdAt: at });
    return { ...row };
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

  async depotCustomerAggregates(depotId: string): Promise<DepotCustomerAggregate[]> {
    const byCustomer = new Map<string, OrderRecord[]>();
    for (const r of this.rows) {
      if (r.depotId !== depotId || r.status === OrderStatus.CANCELLED) continue;
      (byCustomer.get(r.customerId) ?? byCustomer.set(r.customerId, []).get(r.customerId)!).push(r);
    }
    return [...byCustomer.entries()].map(([customerId, rows]) => {
      const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const latest = sorted[sorted.length - 1]!;
      return {
        customerId,
        name: latest.recipientName ?? null,
        phone: latest.phone ?? null,
        orderCount: rows.length,
        totalSpent: rows.reduce((s, r) => s + r.total, 0),
        firstOrderAt: sorted[0]!.createdAt,
        lastOrderAt: latest.createdAt,
      };
    });
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
      const cur = byCustomer.get(r.customerId) ?? {
        count: 0,
        first: r.createdAt,
        last: r.createdAt,
      };
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
    const rec: SubscriptionRecord = {
      ...data,
      id: randomUUID(),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
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
  async advance(id: string, from: Date, to: Date): Promise<boolean> {
    // The compare-and-set the real repository does in its WHERE: a second sweep holding
    // the same row finds the schedule already moved and claims nothing.
    const r = this.rows.find(
      (x) => x.id === id && x.status === 'ACTIVE' && x.nextDeliveryAt.getTime() === from.getTime(),
    );
    if (!r) return false;
    r.nextDeliveryAt = to;
    r.updatedAt = nextDate();
    return true;
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

export class InMemorySettingsRepository implements SettingsRepository {
  rows: (SettingRow & { updatedBy: string })[] = [];

  async loadAll(): Promise<SettingRow[]> {
    return this.rows.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value }));
  }
  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key,
    );
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
  }
  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.scope === scope && r.depotId === depotId && r.key === key,
    );
    if (i >= 0) this.rows.splice(i, 1);
  }
}

export class FakeDepotDirectory implements DepotDirectoryPort {
  depots: DepotLocation[] = [];
  /** Simulate the directory being unreachable (fail-open null), not just empty. */
  unreachable = false;
  /** depotId -> franchise owner; unset means the depot has no owner (or lookup failed). */
  owners = new Map<string, string>();
  /** depotId -> ownership type; unset reads as the company-owned default. */
  ownershipTypes = new Map<string, 'WARALABA' | 'HKP'>();
  async listActiveDepots(): Promise<DepotLocation[] | null> {
    return this.unreachable ? null : this.depots.map((d) => ({ ...d }));
  }
  /** depotId -> its own phone; a depot absent here has none and falls back to ops. */
  contactPhones = new Map<string, string>();
  async listContacts(): Promise<DepotContact[] | null> {
    if (this.unreachable) return null;
    return this.depots.map((d) => ({
      id: d.id,
      name: d.name ?? d.id,
      contactPhone: this.contactPhones.get(d.id) ?? null,
    }));
  }
  async findOwner(depotId: string): Promise<DepotOwnership | null> {
    if (this.unreachable) return null;
    const ownerId = this.owners.get(depotId) ?? null;
    return {
      ownerId,
      ownershipType: this.ownershipTypes.get(depotId) ?? (ownerId ? 'WARALABA' : 'HKP'),
    };
  }
}

export class FakeFranchiseRevenue implements FranchiseRevenuePort {
  posted: OrderRevenueEvent[] = [];
  voided: { orderId: string; reason: string }[] = [];
  /** When set, orderVoided throws it — payout down while a void is in flight. */
  voidError: Error | null = null;
  async orderCompleted(event: OrderRevenueEvent): Promise<void> {
    this.posted.push(event);
  }
  async orderVoided(orderId: string, reason: string): Promise<void> {
    if (this.voidError) throw this.voidError;
    this.voided.push({ orderId, reason });
  }
}

export class FakeCashierShift implements CashierShiftPort {
  /** Defaults to open: only the shift tests care, and every other counter test needs one. */
  open = true;
  calls: { depotId: string; authorization: string }[] = [];
  async hasOpenShift(depotId: string, authorization: string): Promise<boolean> {
    this.calls.push({ depotId, authorization });
    return this.open;
  }
}

export class FakePaymentReversal implements PaymentReversalPort {
  calls: { orderId: string; reason: string }[] = [];
  /** When set, voidForOrder throws it — payment-service down while a void is in flight. */
  error: Error | null = null;
  async voidForOrder(orderId: string, reason: string): Promise<void> {
    if (this.error) throw this.error;
    this.calls.push({ orderId, reason });
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

  setRule(
    depotId: string,
    productId: string,
    adjustType: 'PERCENT' | 'FIXED',
    value: number,
  ): void {
    const row = this.forDepot(depotId).get(productId) ?? {};
    this.forDepot(depotId).set(productId, { ...row, adjustType, value });
  }

  /** A wholesale band that only kicks in from `minQty` units, like the real tiers. */
  setTier(depotId: string, productId: string, minQty: number, tierPrice: number): void {
    this.tiers.set(`${depotId}:${productId}`, { minQty, tierPrice });
  }

  private readonly tiers = new Map<string, { minQty: number; tierPrice: number }>();

  /** Set to mimic depot-service being down: prices still resolve, flagged as not the depot's. */
  unavailable = false;

  async getPrices(
    depotId: string,
    productIds: string[],
    quantities: number[] = [],
  ): Promise<{ prices: Map<string, DepotPrice>; unavailable: boolean }> {
    this.calls.push({ depotId, productIds });
    const forDepot = this.overrides.get(depotId) ?? new Map<string, DepotPrice>();
    const result = new Map<string, DepotPrice>();
    productIds.forEach((id, i) => {
      const row = forDepot.get(id);
      const band = this.tiers.get(`${depotId}:${id}`);
      const qty = quantities[i] ?? 0;
      const tiered = band && qty >= band.minQty ? { tierPrice: band.tierPrice } : {};
      const merged = { ...(row ?? {}), ...tiered };
      if (Object.keys(merged).length > 0) result.set(id, merged);
    });
    return { prices: this.unavailable ? new Map() : result, unavailable: this.unavailable };
  }
}

export interface AwardCall {
  customerId: string;
  orderId: string;
  subtotal: number;
  depotId: string | null;
  authorization: string;
}

export class FakeLoyaltyCoordination implements LoyaltyCoordinationPort {
  calls: AwardCall[] = [];
  /** What the next award reports back; null mimics loyalty being down (fail-open). */
  pointsEarned: number | null = 60;
  async awardPoints(
    customerId: string,
    orderId: string,
    subtotal: number,
    depotId: string | null,
    authorization: string,
  ): Promise<number | null> {
    this.calls.push({ customerId, orderId, subtotal, depotId, authorization });
    return this.pointsEarned;
  }
  reversals: { customerId: string; orderId: string; reason: string }[] = [];
  /** When set, reversePoints throws it — loyalty down while a void is in flight. */
  reverseError: Error | null = null;
  async reversePoints(customerId: string, orderId: string, reason: string): Promise<void> {
    if (this.reverseError) throw this.reverseError;
    this.reversals.push({ customerId, orderId, reason });
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
    items: {
      productId: string;
      productName: string;
      sku: string;
      unit: string;
      quantity: number;
    }[];
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
  reserveCalls: { depotId: string; orderId: string; items: SoldLine[]; authorization: string }[] =
    [];
  releaseCalls: { depotId: string; orderId: string; items: SoldLine[]; authorization: string }[] =
    [];
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
  restockCalls: { depotId: string; orderId: string; items: SoldLine[]; authorization: string }[] =
    [];
  /** When set, restock() throws it — depot-service down while a void is in flight. */
  restockError: Error | null = null;
  async restock(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void> {
    if (this.restockError) throw this.restockError;
    this.restockCalls.push({ depotId, orderId, items, authorization });
  }
}

export class FakeMembership implements MembershipPort {
  rate = 0;
  calls: { authorization: string; depotId: string | null }[] = [];
  /** Counter-sale reads, which are by customer id rather than by token. */
  byCustomerCalls: { customerId: string; depotId: string | null }[] = [];
  async getDiscountRate(authorization: string, depotId: string | null = null): Promise<number> {
    this.calls.push({ authorization, depotId });
    return this.rate;
  }
  async getDiscountRateFor(customerId: string, depotId: string | null = null): Promise<number> {
    this.byCustomerCalls.push({ customerId, depotId });
    return this.rate;
  }
}

export class FakeResellerDiscount implements ResellerDiscountPort {
  result: ResellerDiscount | null = null;
  /** Counter sales resolve by buyer id; recorded so a test can prove WHOSE status was read. */
  readonly byCustomerCalls: string[] = [];
  async get(_authorization: string): Promise<ResellerDiscount | null> {
    return this.result;
  }
  async getFor(customerId: string, _authorization: string): Promise<ResellerDiscount | null> {
    this.byCustomerCalls.push(customerId);
    return this.result;
  }
}

/** §I: records which depot each checkout claimed, and whether it was the first. */
export class FakeCustomerDirectory implements CustomerDirectoryPort {
  readonly claims: { customerId: string; depotId: string }[] = [];
  private readonly claimed = new Set<string>();
  async claimFavoriteDepot(customerId: string, depotId: string): Promise<boolean> {
    this.claims.push({ customerId, depotId });
    if (this.claimed.has(customerId)) return false;
    this.claimed.add(customerId);
    return true;
  }

  /** phone -> customer id, as customer-service would resolve it. Empty = unreachable. */
  readonly byPhone = new Map<string, string>();
  readonly resolveCalls: { phone: string; fullName: string; depotId: string }[] = [];
  async resolveByPhone(phone: string, fullName: string, depotId: string): Promise<string | null> {
    this.resolveCalls.push({ phone, fullName, depotId });
    return this.byPhone.get(phone) ?? null;
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
  /** Mirrors promo-service's DiscountType; FREE_SHIPPING is capped against the fee. */
  quoteDiscountType: string | undefined = undefined;
  rejectQuote = false;
  quoteCalls: { code: string; subtotal: number; shippingFee: number }[] = [];
  /** Counter-sale quotes, which name the buyer instead of riding the caller's token. */
  quoteForCalls: { code: string; customerId: string; subtotal: number; shippingFee: number }[] = [];
  redeemCalls: { code: string; orderId: string; subtotal: number; shippingFee: number }[] = [];

  async quote(
    code: string,
    _customerId: string,
    subtotal: number,
    shippingFee: number,
    _authorization: string,
  ): Promise<{ discount: number; discountType?: string }> {
    if (this.rejectQuote) throw new VoucherRejectedError('Minimum spend not met.');
    this.quoteCalls.push({ code, subtotal, shippingFee });
    return { discount: this.quoteDiscount, discountType: this.quoteDiscountType };
  }
  async quoteFor(
    code: string,
    customerId: string,
    subtotal: number,
    shippingFee: number,
  ): Promise<{ discount: number; discountType?: string }> {
    if (this.rejectQuote) throw new VoucherRejectedError('Minimum spend not met.');
    this.quoteForCalls.push({ code, customerId, subtotal, shippingFee });
    return { discount: this.quoteDiscount, discountType: this.quoteDiscountType };
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
      volumeMl: 19000,
      isGallon: true,
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
  // Audit S-7: the batch the order path uses. Counted, because "one call for the whole
  // cart" is the claim the baseline makes.
  batchCalls = 0;
  async getProducts(productIds: string[]): Promise<Map<string, CatalogProduct>> {
    this.batchCalls += 1;
    if (this.throwOnGet) {
      throw new Error('catalog down');
    }
    const found = new Map<string, CatalogProduct>();
    for (const id of productIds) {
      const product = this.products.get(id);
      // The real route returns ACTIVE products only; an inactive one is simply absent.
      if (product && product.active) found.set(id, product);
    }
    return found;
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
    ORDER_STALLED_HOURS: '24',
    ORDER_ABANDON_MINUTES: '60',
    ORDER_SUBSCRIPTION_DISCOUNT_PCT: '5',
    ORDER_EXPRESS_ENABLED: '1',
    ORDER_EXPRESS_FEE: '5000',
    ORDER_EXPRESS_ETA_MIN_MINUTES: '30',
    ORDER_EXPRESS_ETA_MAX_MINUTES: '60',
    ORDER_DELIVERY_SLOTS: '09.00-11.00,11.00-13.00',
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
  // ponytail: empty-row cache — every business getter falls through to the env value
  // above, matching today's (pre-settings-cache) behavior exactly.
  return new OrderConfigService(
    fake as unknown as ConfigService,
    new SettingsCache({ loadAll: async () => [] }),
  );
}

/**
 * In-memory outbox (H-10). Models what the table guarantees: one row per (topic, order),
 * and a claim that only yields PENDING rows whose backoff has elapsed.
 */
export class InMemoryOutboxRepository implements OutboxRepository {
  rows: OutboxMessageRecord[] = [];

  /** Stands in for the transactional write the repositories do alongside the order. */
  enqueue(writes: OutboxWrite[]): void {
    for (const w of writes) {
      if (this.rows.some((r) => r.topic === w.topic && r.orderId === w.orderId)) continue;
      this.rows.push({
        id: randomUUID(),
        topic: w.topic,
        orderId: w.orderId,
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(0),
        lastError: null,
        createdAt: nextDate(),
      });
    }
  }

  async claimDue(now: Date, limit: number): Promise<OutboxMessageRecord[]> {
    return this.rows
      .filter((r) => r.status === 'PENDING' && r.nextAttemptAt.getTime() <= now.getTime())
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async markDone(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id)!;
    row.status = 'DONE';
    row.lastError = null;
  }
  async markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void> {
    const row = this.rows.find((r) => r.id === id)!;
    row.status = nextAttemptAt ? 'PENDING' : 'DEAD';
    row.attempts += 1;
    row.lastError = error;
    if (nextAttemptAt) row.nextAttemptAt = nextAttemptAt;
  }
  async countByStatus(): Promise<Record<OutboxStatus, number>> {
    const counts: Record<OutboxStatus, number> = { PENDING: 0, DONE: 0, DEAD: 0 };
    for (const r of this.rows) counts[r.status] += 1;
    return counts;
  }
}

/**
 * An OutboxService wired to an in-memory outbox and hooked up to the order repository,
 * so a test's OrderService enqueues and delivers exactly as production does (H-10).
 */
export function buildOutbox(orders: InMemoryOrderRepository): OutboxService {
  const repo = new InMemoryOutboxRepository();
  orders.outbox = repo;
  return new OutboxService(repo, orders);
}
