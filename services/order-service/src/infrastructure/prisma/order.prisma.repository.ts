import { Injectable } from '@nestjs/common';

import { OrderStatus as DbOrderStatus, Prisma } from '../../../prisma/generated/client';
import { OrderStatus } from '../../domain/order-status';
import {
  CreateOrderData,
  CreateReviewData,
  CustomerLifetime,
  CustomerSales,
  DepotSales,
  DepotRating,
  DepotShipping,
  OrderQuery,
  OrderRecord,
  OrderRepository,
  OrderReviewRecord,
  ProductRevenue,
  ReportRange,
  RetentionCell,
  SalesBucket,
  SegmentConditions,
} from '../../application/ports/order.repository';
import { PrismaService } from './prisma.service';

type Decimalish = { toNumber(): number };

interface ItemRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: Decimalish;
  quantity: number;
  lineTotal: Decimalish;
}

interface HistoryRow {
  // Prisma generates a structurally-distinct enum; kept as string and narrowed
  // to the domain OrderStatus in the mapper (identical member values).
  status: string;
  changedBy: string | null;
  note: string | null;
  createdAt: Date;
}

interface ReviewRow {
  id: string;
  orderId: string;
  customerId: string;
  rating: number;
  aspects: string[];
  comment: string | null;
  tipAmount: number;
  createdAt: Date;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  customerId: string;
  depotId: string | null;
  status: string;
  subtotal: Decimalish;
  deliveryFee: Decimalish;
  discount: Decimalish;
  total: Decimalish;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  driverName: string | null;
  items: ItemRow[];
  history: HistoryRow[];
  review: ReviewRow | null;
  createdAt: Date;
  updatedAt: Date;
}

const INCLUDE = {
  items: true,
  history: { orderBy: { createdAt: 'asc' as const } },
  review: true,
};

@Injectable()
export class OrderPrismaRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: OrderRow): OrderRecord {
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      customerId: row.customerId,
      depotId: row.depotId,
      status: row.status as OrderStatus,
      subtotal: row.subtotal.toNumber(),
      deliveryFee: row.deliveryFee.toNumber(),
      discount: row.discount.toNumber(),
      total: row.total.toNumber(),
      recipientName: row.recipientName,
      phone: row.phone,
      addressLine: row.addressLine,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
      latitude: row.latitude,
      longitude: row.longitude,
      notes: row.notes,
      driverName: row.driverName,
      items: row.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        unit: i.unit,
        unitPrice: i.unitPrice.toNumber(),
        quantity: i.quantity,
        lineTotal: i.lineTotal.toNumber(),
      })),
      history: row.history.map((h) => ({
        status: h.status as OrderStatus,
        changedBy: h.changedBy,
        note: h.note,
        createdAt: h.createdAt,
      })),
      reviewed: row.review != null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toReview(row: ReviewRow): OrderReviewRecord {
    return {
      id: row.id,
      orderId: row.orderId,
      customerId: row.customerId,
      rating: row.rating,
      aspects: row.aspects,
      comment: row.comment,
      tipAmount: row.tipAmount,
      createdAt: row.createdAt,
    };
  }

  async findReorderReminderTargets(
    cutoff: Date,
    limit: number,
  ): Promise<{ customerId: string; phone: string; recipientName: string }[]> {
    // Customers whose LATEST order is older than the cutoff = no order since.
    const grouped = await this.prisma.order.groupBy({
      by: ['customerId'],
      _max: { createdAt: true },
    });
    const dueIds = grouped
      .filter((g) => g._max.createdAt != null && g._max.createdAt < cutoff)
      .map((g) => g.customerId)
      .slice(0, limit);
    if (dueIds.length === 0) return [];
    // One latest order per due customer (distinct + desc) for the phone/name snapshot.
    const rows = await this.prisma.order.findMany({
      where: { customerId: { in: dueIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['customerId'],
      select: { customerId: true, phone: true, recipientName: true },
    });
    return rows;
  }

  async createReview(data: CreateReviewData): Promise<OrderReviewRecord> {
    const row = await this.prisma.orderReview.create({ data });
    return this.toReview(row);
  }

  async findReviewByOrderId(orderId: string): Promise<OrderReviewRecord | null> {
    const row = await this.prisma.orderReview.findUnique({ where: { orderId } });
    return row ? this.toReview(row) : null;
  }

  async create(data: CreateOrderData): Promise<OrderRecord> {
    const { items, id, ...order } = data;
    const row = await this.prisma.order.create({
      data: {
        ...(id ? { id } : {}),
        ...order,
        status: OrderStatus.CREATED,
        items: { create: items },
        history: { create: { status: OrderStatus.CREATED } },
      },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    return row ? this.toRecord(row) : null;
  }

  async search(query: OrderQuery): Promise<{ items: OrderRecord[]; total: number }> {
    const where = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.depotId ? { depotId: query.depotId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
  }

  async findStaleCreated(before: Date): Promise<OrderRecord[]> {
    const rows = await this.prisma.order.findMany({
      where: { status: OrderStatus.CREATED, createdAt: { lt: before } },
      include: INCLUDE,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findCompletedPage(
    cursor: string | null,
    limit: number,
  ): Promise<{ orders: OrderRecord[]; nextCursor: string | null }> {
    let from: { createdAt: Date; id: string } | null = null;
    if (cursor) {
      from = await this.prisma.order.findUnique({
        where: { id: cursor },
        select: { createdAt: true, id: true },
      });
    }
    const rows = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.COMPLETED,
        ...(from
          ? {
              OR: [
                { createdAt: { gt: from.createdAt } },
                { createdAt: from.createdAt, id: { gte: from.id } },
              ],
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      orders: page.map((r) => this.toRecord(r)),
      nextCursor: hasMore ? rows[limit].id : null,
    };
  }

  async applyStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
    driverName?: string | null,
  ): Promise<OrderRecord> {
    const row = await this.prisma.order.update({
      where: { id },
      data: {
        status,
        ...(driverName != null ? { driverName } : {}),
        history: { create: { status, changedBy, note } },
      },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  /** Non-cancelled orders in the window; the shared filter for every report. */
  private reportWhere(range: ReportRange) {
    const createdAt = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
    return {
      status: { not: DbOrderStatus.CANCELLED },
      ...(range.from || range.to ? { createdAt } : {}),
    };
  }

  async salesSeries(
    granularity: 'daily' | 'monthly',
    range: ReportRange,
  ): Promise<SalesBucket[]> {
    // Whitelisted so the trunc unit / format are never attacker-controlled.
    const unit = granularity === 'monthly' ? 'month' : 'day';
    const fmt = granularity === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const conds: Prisma.Sql[] = [Prisma.sql`"status" <> 'CANCELLED'::"OrderStatus"`];
    if (range.from) conds.push(Prisma.sql`"createdAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`"createdAt" < ${range.to}`);
    const rows = await this.prisma.$queryRaw<
      { period: string; orderCount: bigint; revenue: Prisma.Decimal | null }[]
    >(Prisma.sql`
      SELECT to_char(date_trunc(${unit}, "createdAt"), ${fmt}) AS period,
             COUNT(*)::bigint AS "orderCount",
             COALESCE(SUM("total"), 0) AS revenue
      FROM "orders"
      WHERE ${Prisma.join(conds, ' AND ')}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows.map((r) => ({
      period: r.period,
      orderCount: Number(r.orderCount),
      revenue: r.revenue ? Number(r.revenue) : 0,
    }));
  }

  async topCustomers(range: ReportRange, limit: number): Promise<CustomerSales[]> {
    const rows = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: this.reportWhere(range),
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      customerId: r.customerId,
      orderCount: r._count._all,
      revenue: r._sum.total ? r._sum.total.toNumber() : 0,
    }));
  }

  async topDepots(range: ReportRange, limit: number): Promise<DepotSales[]> {
    const rows = await this.prisma.order.groupBy({
      by: ['depotId'],
      where: { ...this.reportWhere(range), depotId: { not: null } },
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      depotId: r.depotId as string,
      orderCount: r._count._all,
      revenue: r._sum.total ? r._sum.total.toNumber() : 0,
    }));
  }

  async shippingByDepot(range: ReportRange): Promise<DepotShipping[]> {
    const rows = await this.prisma.order.groupBy({
      by: ['depotId'],
      where: { ...this.reportWhere(range), depotId: { not: null } },
      _sum: { deliveryFee: true },
    });
    return rows.map((r) => ({
      depotId: r.depotId as string,
      shippingBilled: r._sum.deliveryFee ? r._sum.deliveryFee.toNumber() : 0,
    }));
  }

  async ratingByDepot(range: ReportRange): Promise<DepotRating[]> {
    // OrderReview has no depotId, so join through the parent order. Range filters
    // the order's createdAt to match every other by-depot report's semantics.
    const conds: Prisma.Sql[] = [Prisma.sql`o."depotId" IS NOT NULL`];
    if (range.from) conds.push(Prisma.sql`o."createdAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`o."createdAt" < ${range.to}`);
    const where = Prisma.join(conds, ' AND ');
    const rows = await this.prisma.$queryRaw<
      { depotId: string; rating: number; reviewCount: bigint }[]
    >(Prisma.sql`
      SELECT o."depotId" AS "depotId",
             AVG(r.rating)::float AS rating,
             COUNT(*)::bigint AS "reviewCount"
      FROM "order_reviews" r
      JOIN "orders" o ON o.id = r."orderId"
      WHERE ${where}
      GROUP BY o."depotId"
    `);
    return rows.map((r) => ({
      depotId: r.depotId,
      rating: r.rating,
      reviewCount: Number(r.reviewCount),
    }));
  }

  async revenueByProduct(range: ReportRange, limit: number): Promise<ProductRevenue[]> {
    // Group the line items whose parent order is non-cancelled & in-window. OrderItem
    // has no category column, so this is a per-PRODUCT breakdown (see ProductRevenue).
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId', 'productName'],
      where: { order: this.reportWhere(range) },
      _sum: { lineTotal: true },
      _count: { _all: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      orderCount: r._count._all,
      revenue: r._sum.lineTotal ? r._sum.lineTotal.toNumber() : 0,
    }));
  }

  async retentionCohort(range: ReportRange): Promise<RetentionCell[]> {
    const conds: Prisma.Sql[] = [Prisma.sql`"status" <> 'CANCELLED'::"OrderStatus"`];
    if (range.from) conds.push(Prisma.sql`"createdAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`"createdAt" < ${range.to}`);
    const where = Prisma.join(conds, ' AND ');
    const rows = await this.prisma.$queryRaw<
      { cohort: string; monthIndex: number; customers: bigint }[]
    >(Prisma.sql`
      WITH first_order AS (
        SELECT "customerId", date_trunc('month', MIN("createdAt")) AS cohort
        FROM "orders" WHERE ${where} GROUP BY "customerId"
      ),
      activity AS (
        SELECT DISTINCT "customerId", date_trunc('month', "createdAt") AS active_month
        FROM "orders" WHERE ${where}
      )
      SELECT to_char(f.cohort, 'YYYY-MM') AS cohort,
             ((EXTRACT(YEAR FROM a.active_month) - EXTRACT(YEAR FROM f.cohort)) * 12
              + (EXTRACT(MONTH FROM a.active_month) - EXTRACT(MONTH FROM f.cohort)))::int
               AS "monthIndex",
             COUNT(DISTINCT f."customerId")::bigint AS customers
      FROM first_order f
      JOIN activity a ON a."customerId" = f."customerId"
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    return rows.map((r) => ({
      cohort: r.cohort,
      monthIndex: Number(r.monthIndex),
      customers: Number(r.customers),
    }));
  }

  async customerLifetime(customerId: string): Promise<CustomerLifetime> {
    const agg = await this.prisma.order.aggregate({
      where: { customerId, status: { not: DbOrderStatus.CANCELLED } },
      _sum: { total: true },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    return {
      orderCount: agg._count._all,
      revenue: agg._sum.total ? agg._sum.total.toNumber() : 0,
      firstOrderAt: agg._min.createdAt,
      lastOrderAt: agg._max.createdAt,
    };
  }

  async audienceReach(depotId?: string): Promise<number> {
    const conds: Prisma.Sql[] = [Prisma.sql`"status" <> 'CANCELLED'::"OrderStatus"`];
    if (depotId) conds.push(Prisma.sql`"depotId" = ${depotId}::uuid`);
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "customerId")::bigint AS count
      FROM "orders"
      WHERE ${Prisma.join(conds, ' AND ')}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  async segmentEstimate(conditions: SegmentConditions): Promise<number> {
    // Depot scopes WHERE (so frequency/recency are computed over that depot's orders);
    // frequency/recency are HAVING predicates over the per-customer aggregate.
    const where: Prisma.Sql[] = [Prisma.sql`"status" <> 'CANCELLED'::"OrderStatus"`];
    if (conditions.depotId) where.push(Prisma.sql`"depotId" = ${conditions.depotId}::uuid`);
    const having: Prisma.Sql[] = [];
    if (conditions.minOrders != null) having.push(Prisma.sql`COUNT(*) >= ${conditions.minOrders}`);
    if (conditions.recencyCutoff)
      having.push(Prisma.sql`MAX("createdAt") >= ${conditions.recencyCutoff}`);
    if (conditions.lapsedCutoff)
      having.push(Prisma.sql`MAX("createdAt") < ${conditions.lapsedCutoff}`);
    if (conditions.firstOrderCutoff)
      having.push(Prisma.sql`MIN("createdAt") >= ${conditions.firstOrderCutoff}`);
    const havingSql = having.length
      ? Prisma.sql`HAVING ${Prisma.join(having, ' AND ')}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT "customerId"
        FROM "orders"
        WHERE ${Prisma.join(where, ' AND ')}
        GROUP BY "customerId"
        ${havingSql}
      ) t
    `);
    return Number(rows[0]?.count ?? 0);
  }
}
