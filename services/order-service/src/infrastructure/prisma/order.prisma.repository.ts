import { Injectable } from '@nestjs/common';
import { depotWhere, nextCursor, pageArgs, readAllPages } from '@hydromart/platform';

import { OrderStatus as DbOrderStatus, Prisma } from '../../../prisma/generated/client';
import { ANONYMOUS_CUSTOMER_ID } from '../../domain/anonymous';
import { OrderStatus } from '../../domain/order-status';
import {
  DuplicateCheckoutError,
  OrderAlreadyVoidedError,
  ReportRangeTooLargeError,
  StaleOrderStatusError,
} from '../../domain/errors';
import {
  CreateOrderData,
  CreateReviewData,
  CustomerLifetime,
  CustomerSales,
  DepotCustomerAggregate,
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
} from '../../application/ports/order.repository';
import { OutboxWrite } from '../../application/ports/outbox.repository';
import { PrismaService } from './prisma.service';

/** Rows per keyset page when a report has to walk a whole window (audit H-46). */
const REPORT_PAGE_SIZE = 500;
/**
 * Ceiling on one report's window. ~20k orders is several months for a busy depot and
 * still fits comfortably in memory; past it the caller is asked to narrow the range
 * rather than handed a number built from part of it.
 */
const MAX_REPORT_ORDERS = 20_000;
/** Orders one stale-sweep tick will claim. The next tick picks up the rest. */
const STALE_SWEEP_BATCH = 500;
/**
 * W2b: what checkout stores in `deliveryWindow` when the customer wants "antar sekarang"
 * (apps/web/src/app/checkout/page.tsx `EXPRESS_WINDOW`). Express is a request for NOW, so
 * it is not a schedule and earns none of the grace below — an express order still sitting
 * in CREATED an hour later IS abandoned.
 */
const EXPRESS_WINDOW = 'Antar sekarang (express)';
/**
 * W2b: how much longer an order the customer booked for a later day gets before the
 * abandoned sweep may touch it.
 *
 * A grace, not an amnesty. Checkout offers the next four days and nothing beyond
 * (`buildDates` in the checkout screen), so an order stale by more than that has outlived
 * the furthest slot anyone can book and is abandoned like any other — the alternative is a
 * reservation nothing ever releases.
 *
 * ponytail: four days is the booking HORIZON, not the booked date. `deliveryWindow` is a
 * free-form label ("Besok, 09.00-12.00") whose day part comes from the browser's
 * dictionary, so the day itself cannot be read here at all. A `scheduledFor` column would
 * replace this constant and the literal above with one comparison.
 *
 * Plain millisecond arithmetic on a Date, so the naive-timestamp two-hop rule (see
 * `salesSeries`) does not apply: no day boundary is being cut, only an instant moved.
 */
const SCHEDULED_GRACE_MS = 4 * 24 * 3_600_000;

type Decimalish = { toNumber(): number };

interface ItemRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  volumeMl: number | null;
  isGallon: boolean;
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
  province: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  deliveryWindow: string | null;
  isWalkIn: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
  subscriptionId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  estimatedArrivalAt: Date | null;
  items: ItemRow[];
  // Absent on the report and sweep reads, which do not render a timeline (audit S-23).
  history?: HistoryRow[];
  // id-only: toRecord derives just the `reviewed` flag (INCLUDE selects id alone, DB-9).
  review: { id: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Statuses that never count as business: an order that never happened (CANCELLED) and a
 * counter sale that was reversed at the till with the money handed back (VOIDED). Every
 * revenue, customer-value and depot report filters both out through this one list.
 */
const VOID_LIKE = [DbOrderStatus.CANCELLED, DbOrderStatus.VOIDED];
/**
 * The same exclusion for the raw-SQL reports (H-14).
 *
 * Four `$queryRaw` reports — the revenue series, the retention cohort, the audience
 * reach and the segment estimate — excluded only CANCELLED, while every Prisma-built
 * report next to them excluded VOID_LIKE. A voided counter sale is a sale that did not
 * happen; counting it inflated reported revenue and left the buyer in a retention cohort
 * they never joined. One fragment so the two can no longer drift apart.
 */
const NOT_VOID_SQL = Prisma.sql`"status" NOT IN (${Prisma.join(
  VOID_LIKE.map((status) => Prisma.sql`${status}::"OrderStatus"`),
)})`;

const INCLUDE = {
  items: true,
  history: { orderBy: { createdAt: 'asc' as const } },
  // toRecord only needs `review != null` (the `reviewed` flag) — never the review body,
  // which is fetched on demand via findReviewByOrderId. id-only keeps list/detail reads
  // from hauling the comment/aspects text for every row (DB-9). ponytail: history stays
  // full — it's bounded (status transitions) and serialized to the order card/timeline.
  review: { select: { id: true } },
};

/**
 * A Prisma unique-constraint violation (P2002) naming `field`, detected without importing
 * the client namespace. Matching the field keeps an unrelated unique from being read as the
 * one the caller can recover from.
 */
function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: string; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
}

/**
 * The same row without its status history (audit S-23). The timeline is what the customer
 * and the ops console read on ONE order; a monthly depot report reads every order that depot
 * took and renders none of them, so it was hauling eight history rows per order for nothing.
 * Reads that use this must not surface `history` — `toRecord` reports it as empty, which is
 * the truth about what was fetched rather than a claim that the order has no timeline.
 */
const INCLUDE_NO_HISTORY = {
  items: INCLUDE.items,
  review: INCLUDE.review,
};

@Injectable()
export class OrderPrismaRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async nextOrderSequence(): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { v: bigint }[]
    >`SELECT nextval('order_number_seq') AS v`;
    return Number(rows[0]?.v ?? 0);
  }

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
      deliveryWindow: row.deliveryWindow,
      isWalkIn: row.isWalkIn,
      voidedAt: row.voidedAt,
      voidReason: row.voidReason,
      subscriptionId: row.subscriptionId,
      driverName: row.driverName,
      driverPhone: row.driverPhone,
      estimatedArrivalAt: row.estimatedArrivalAt,
      items: row.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        unit: i.unit,
        volumeMl: i.volumeMl,
        isGallon: i.isGallon,
        unitPrice: i.unitPrice.toNumber(),
        quantity: i.quantity,
        lineTotal: i.lineTotal.toNumber(),
      })),
      history: (row.history ?? []).map((h) => ({
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
    //
    // The HAVING and the LIMIT are in the statement (audit S-12). Prisma's groupBy has no
    // HAVING over an aggregate it did not select, so this used to group the WHOLE order
    // table, ship every customer who has ever ordered back to Node, and throw away all but
    // `limit` of them in JavaScript — the cost of one reminder sweep was the whole customer
    // base.
    const rows = await this.prisma.$queryRaw<{ customerId: string }[]>(Prisma.sql`
      SELECT "customerId"
      FROM "orders"
      GROUP BY "customerId"
      HAVING MAX("createdAt") < ${cutoff}
      ORDER BY MAX("createdAt") ASC
      LIMIT ${limit}
    `);
    const dueIds = rows.map((r) => r.customerId);
    if (dueIds.length === 0) return [];
    return this.latestContactPerCustomer(dueIds);
  }

  /**
   * The phone/name snapshot from each customer's most recent order.
   *
   * DISTINCT ON rather than Prisma's `distinct`: that option is applied to the rows the
   * query returned, so combining it with any `take` — including the default bound every
   * findMany now carries — can dedupe down to fewer customers than were asked for, and
   * the missing ones simply have no contact details. Postgres does the dedupe here, so
   * the result is exactly one row per id.
   */
  private latestContactPerCustomer(
    customerIds: string[],
    depotId?: string,
  ): Promise<{ customerId: string; phone: string; recipientName: string }[]> {
    const scope = depotId ? Prisma.sql`AND "depotId" = ${depotId}::uuid` : Prisma.empty;
    return this.prisma.$queryRaw<{ customerId: string; phone: string; recipientName: string }[]>(
      Prisma.sql`
        SELECT DISTINCT ON ("customerId") "customerId", "phone", "recipientName"
        FROM "orders"
        WHERE "customerId" IN (${Prisma.join(customerIds.map((id) => Prisma.sql`${id}::uuid`))})
        ${scope}
        ORDER BY "customerId", "createdAt" DESC
      `,
    );
  }

  async createReview(data: CreateReviewData): Promise<OrderReviewRecord> {
    const row = await this.prisma.orderReview.create({ data });
    return this.toReview(row);
  }

  async findReviewByOrderId(orderId: string): Promise<OrderReviewRecord | null> {
    const row = await this.prisma.orderReview.findUnique({ where: { orderId } });
    return row ? this.toReview(row) : null;
  }

  async avgRatingForOrders(orderIds: string[]): Promise<RatingSummary> {
    if (orderIds.length === 0) return { average: null, count: 0 };
    const agg = await this.prisma.orderReview.aggregate({
      where: { orderId: { in: orderIds } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return { average: agg._avg.rating, count: agg._count._all };
  }

  async create(data: CreateOrderData): Promise<OrderRecord> {
    const { items, id, status, outbox = [], ...order } = data;
    // A walk-in sale is created already COMPLETED (the goods left with the buyer), so the
    // seed history row has to match the row's real status, not a CREATED it never was.
    const opening = status ?? OrderStatus.CREATED;
    try {
      // H-10: a walk-in is born COMPLETED, so the effects it earns are written with it
      // rather than at a later transition. One transaction, or neither.
      const [row] = await this.prisma.$transaction([
        this.prisma.order.create({
          data: {
            ...(id ? { id } : {}),
            ...order,
            status: opening,
            items: { create: items },
            history: { create: { status: opening } },
          },
          include: INCLUDE,
        }),
        ...outbox.map((m) => this.prisma.outboxMessage.create({ data: m })),
      ]);
      return this.toRecord(row);
    } catch (error) {
      // B-13: the retry lost the race against the attempt that is already committing.
      // `orders_customerId_idempotencyKey_key` is the only unique this write can violate
      // that the caller can recover from — an orderNumber collision (H-12) is ours, not
      // theirs, and must keep surfacing as a failure.
      if (isUniqueViolation(error, 'idempotencyKey')) {
        throw new DuplicateCheckoutError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    return row ? this.toRecord(row) : null;
  }

  async findByIdempotencyKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      include: INCLUDE,
    });
    return row ? this.toRecord(row) : null;
  }

  async assignDepot(id: string, depotId: string): Promise<OrderRecord> {
    const row = await this.prisma.order.update({
      where: { id },
      data: { depotId },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async findOrderValues(orderIds: string[]): Promise<OrderValue[]> {
    const rows = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, total: true, depotId: true },
    });
    return rows.map((row) => ({
      orderId: row.id,
      orderNumber: row.orderNumber,
      totalIdr: Math.round(row.total.toNumber()),
      depotId: row.depotId,
    }));
  }

  async sumDepotSales(depotId: string, from: Date, to: Date): Promise<number> {
    const agg = await this.prisma.order.aggregate({
      _sum: { total: true },
      where: {
        depotId,
        status: { in: ['DELIVERED', 'COMPLETED'] },
        createdAt: { gte: from, lte: to },
      },
    });
    return agg._sum.total ? Math.round(agg._sum.total.toNumber()) : 0;
  }

  async depotDailyGallons(
    depotId: string,
    from: Date,
    to: Date,
    tz: string,
  ): Promise<{ day: string; gallons: number }[]> {
    // The day boundary is WIB, NOT UTC — `date_trunc('day', "createdAt")` (what the revenue
    // series does) cuts at 07:00 local and would pay the daily bonus against a window that
    // does not line up with `Attendance.workDate`. Two `AT TIME ZONE` hops: the column is a
    // naive timestamp holding UTC, so label it UTC first, then read it in `tz`.
    const rows = await this.prisma.$queryRaw<{ day: string; gallons: bigint | null }[]>(
      Prisma.sql`
      SELECT to_char(
               date_trunc('day', o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}),
               'YYYY-MM-DD'
             ) AS day,
             COALESCE(SUM(i."quantity"), 0)::bigint AS gallons
      FROM "orders" o
      JOIN "order_items" i ON i."orderId" = o."id"
      WHERE o."depotId" = ${depotId}::uuid
        AND o."status" IN (${Prisma.join(
          [DbOrderStatus.DELIVERED, DbOrderStatus.COMPLETED].map(
            (status) => Prisma.sql`${status}::"OrderStatus"`,
          ),
        )})
        AND i."isGallon" = true
        AND o."createdAt" >= ${from}
        AND o."createdAt" < ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    );
    return rows.map((r) => ({ day: r.day, gallons: r.gallons ? Number(r.gallons) : 0 }));
  }

  async search(
    query: OrderQuery,
  ): Promise<{ items: OrderRecord[]; total: number; nextCursor: string | null }> {
    const term = query.orderNumber?.trim();
    const where = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      // C6: counter sales only. `undefined` means "either", which is what every existing
      // caller wants — this filter is opt-in, so no current list changes shape.
      ...(query.isWalkIn === undefined ? {} : { isWalkIn: query.isWalkIn }),
      ...(query.unrouted
        ? { depotId: null }
        : query.depotIds
          ? { depotId: depotWhere(query.depotIds) }
          : {}),
      // Audit F-12: matched over the whole table, not over whatever page the browser
      // happened to hold. `orderNumber` is already indexed for its unique constraint.
      ...(term ? { orderNumber: { contains: term, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: INCLUDE,
        // `id` last so the cursor is unambiguous: two orders created in the same
        // millisecond would otherwise be returned twice or skipped between pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
      nextCursor: nextCursor(rows, query.limit),
    };
  }

  async findStaleIn(
    statuses: OrderStatus[],
    before: Date,
    limit = STALE_SWEEP_BATCH,
    exemptSubscriptions = true,
  ): Promise<OrderRecord[]> {
    if (statuses.length === 0) return [];
    // Bounded batch, oldest first: the sweep runs on a schedule, so a backlog is drained
    // over several ticks instead of one tick trying to load every stale order at once.
    const rows = await this.prisma.order.findMany({
      // D1: a subscription delivery is never a sweep candidate, in either window. The
      // exclusion lives in the query rather than in the caller so a backlog of scheduled
      // orders cannot eat the `take` budget and starve the orders the sweep is for.
      where: {
        status: { in: statuses },
        // B3b: how long it has been STUCK, not how old it is. `createdAt` answered the
        // second question and the sweep was asking the first — see the port for what that
        // cost. The column shipped in B3a; this is the release that reads it.
        statusChangedAt: { lt: before },
        ...(exemptSubscriptions ? { subscriptionId: null } : {}),
        // W2b: an order the customer booked for a later day is not abandoned an hour after
        // checkout — it is waiting, exactly as asked. The sweep read `statusChangedAt`
        // alone, so a CASH order placed at 22.00 for tomorrow morning was cancelled at
        // 23.00 while the depot was still shut: the orders the schedule exists for were
        // the ones it killed. Same reasoning as the D1 exclusion above, and in the query
        // for the same reason — a backlog of deferred orders must not eat the `take`.
        OR: [
          { deliveryWindow: null },
          { deliveryWindow: { in: ['', EXPRESS_WINDOW] } },
          { statusChangedAt: { lt: new Date(before.getTime() - SCHEDULED_GRACE_MS) } },
        ],
      },
      // The sweep cancels and releases stock; it never reads a timeline (audit S-23).
      include: INCLUDE_NO_HISTORY,
      orderBy: { statusChangedAt: 'asc' },
      take: limit,
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

  /** A history row and nothing else — the order's status is repeated, not changed. */
  async appendNote(id: string, status: OrderStatus, changedBy: string, note: string): Promise<void> {
    await this.prisma.orderStatusHistory.create({
      data: { orderId: id, status, changedBy, note },
    });
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
    // `status: from` in the WHERE is the guard (H-4). No match means the order moved
    // under us; P2025 becomes StaleOrderStatusError so the loser is told, not ignored.
    //
    // H-10: the effects the transition earns go in the SAME transaction. The status guard
    // is what makes that safe to pair — only the winner writes, so only the winner owes.
    const [row] = await this.prisma
      .$transaction([
        this.prisma.order.update({
          where: { id, status: from },
          data: {
            status,
            // B3: the moment this order entered THIS status. The stalled sweep needs it
            // because `createdAt` answers a different question, and answering the wrong
            // one cancels orders a depot has only just picked up.
            statusChangedAt: new Date(),
            ...(driverName != null ? { driverName } : {}),
            ...(driverPhone != null ? { driverPhone } : {}),
            ...(estimatedArrivalAt != null ? { estimatedArrivalAt } : {}),
            history: { create: { status, changedBy, note } },
          },
          include: INCLUDE,
        }),
        ...outbox.map((m) => this.prisma.outboxMessage.create({ data: m })),
      ])
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === 'P2025') {
          throw new StaleOrderStatusError();
        }
        throw error;
      });
    return this.toRecord(row);
  }

  /**
   * Orders that really stand, in the window; the shared filter for every report.
   *
   * VOIDED is excluded alongside CANCELLED: a voided counter sale was reversed at the till
   * and the money handed back, so counting it would report revenue the depot does not have.
   */
  private reportWhere(range: ReportRange) {
    const createdAt = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
    return {
      status: { notIn: VOID_LIKE },
      ...(range.from || range.to ? { createdAt } : {}),
    };
  }

  async salesSeries(
    granularity: 'daily' | 'monthly',
    range: ReportRange,
    tz: string,
  ): Promise<SalesBucket[]> {
    // Whitelisted so the trunc unit / format are never attacker-controlled.
    const unit = granularity === 'monthly' ? 'month' : 'day';
    const fmt = granularity === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const conds: Prisma.Sql[] = [NOT_VOID_SQL];
    if (range.from) conds.push(Prisma.sql`"createdAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`"createdAt" < ${range.to}`);
    const rows = await this.prisma.$queryRaw<
      { period: string; orderCount: bigint; revenue: Prisma.Decimal | null }[]
    >(Prisma.sql`
      -- C2: the column is a naive timestamp holding UTC, so a bare date_trunc cuts the day
      -- at 07:00 WIB — every order between midnight and 7am was reported on the day before.
      -- Label it UTC, then read it in the business zone, exactly as depotDailyGallons does.
      SELECT to_char(date_trunc(${unit}, "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), ${fmt}) AS period,
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

  async refundsByDepot(range: ReportRange): Promise<DepotRefund[]> {
    // Unlike the other by-depot reports, refunds must NOT exclude CANCELLED orders:
    // an online-paid order that gets cancelled is precisely what triggers a refund
    // (BR-refund). Window on the order's createdAt to match the sibling lines.
    const createdAt = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
    const rows = await this.prisma.order.groupBy({
      by: ['depotId'],
      where: {
        depotId: { not: null },
        refundedAmount: { not: null },
        ...(range.from || range.to ? { createdAt } : {}),
      },
      _sum: { refundedAmount: true },
    });
    return rows.map((r) => ({
      depotId: r.depotId as string,
      refunded: r._sum.refundedAmount ? r._sum.refundedAmount.toNumber() : 0,
    }));
  }

  async voidWalkIn(id: string, reason: string, changedBy: string, at: Date): Promise<OrderRecord> {
    // Guarded on COMPLETED in the WHERE, not just in the service: two cashiers hitting void
    // on the same sale would otherwise both restock it. The second update matches no row.
    const { count } = await this.prisma.order.updateMany({
      where: { id, status: DbOrderStatus.COMPLETED, isWalkIn: true },
      // B3: `statusChangedAt` here too. A void is a status transition that does not go
      // through `applyStatus`, and a column that only SOME transitions write is worse than
      // no column — it reads as fresh for exactly the rows it never touched.
      data: { status: DbOrderStatus.VOIDED, statusChangedAt: at, voidedAt: at, voidReason: reason },
    });
    if (count === 0) {
      throw new OrderAlreadyVoidedError();
    }
    await this.prisma.orderStatusHistory.create({
      data: { orderId: id, status: DbOrderStatus.VOIDED, changedBy, note: reason },
    });
    const row = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    return this.toRecord(row!);
  }

  async recordRefund(orderId: string, amount: number): Promise<void> {
    await this.prisma.order.update({ where: { id: orderId }, data: { refundedAmount: amount } });
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

  async depotRatings(depotId: string, range: ReportRange): Promise<DepotRatingsDetail> {
    // OrderReview has no depotId, so join through the parent order and window on the
    // order's createdAt (same semantics as ratingByDepot).
    const conds: Prisma.Sql[] = [Prisma.sql`o."depotId" = ${depotId}::uuid`];
    if (range.from) conds.push(Prisma.sql`o."createdAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`o."createdAt" < ${range.to}`);
    const where = Prisma.join(conds, ' AND ');
    const [dist, recent] = await Promise.all([
      this.prisma.$queryRaw<{ rating: number; n: bigint }[]>(Prisma.sql`
        SELECT r.rating AS rating, COUNT(*)::bigint AS n
        FROM "order_reviews" r JOIN "orders" o ON o.id = r."orderId"
        WHERE ${where}
        GROUP BY r.rating
      `),
      this.prisma.$queryRaw<
        { customerName: string; stars: number; comment: string | null; createdAt: Date }[]
      >(Prisma.sql`
        SELECT o."recipientName" AS "customerName", r.rating AS stars,
               r.comment AS comment, r."createdAt" AS "createdAt"
        FROM "order_reviews" r JOIN "orders" o ON o.id = r."orderId"
        WHERE ${where}
        ORDER BY r."createdAt" DESC
        LIMIT 8
      `),
    ]);
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let count = 0;
    let sum = 0;
    for (const d of dist) {
      const n = Number(d.n);
      const star = String(d.rating) as keyof typeof distribution;
      if (star in distribution) distribution[star] = n;
      count += n;
      sum += d.rating * n;
    }
    return {
      average: count === 0 ? null : sum / count,
      count,
      distribution,
      recent: recent.map((x) => ({
        customerName: x.customerName,
        stars: Number(x.stars),
        comment: x.comment,
        createdAt: x.createdAt,
      })),
    };
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

  async retentionCohort(range: ReportRange, tz: string): Promise<RetentionCell[]> {
    const conds: Prisma.Sql[] = [NOT_VOID_SQL];
    if (range.from) conds.push(Prisma.sql`"createdAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`"createdAt" < ${range.to}`);
    const where = Prisma.join(conds, ' AND ');
    const rows = await this.prisma.$queryRaw<
      { cohort: string; monthIndex: number; customers: bigint }[]
    >(Prisma.sql`
      -- C2: both months are cut in the business zone. Cutting one of them in UTC and the
      -- other locally would file a customer's first order in one month and their first
      -- activity in the next, inventing a month-1 churn that never happened.
      WITH first_order AS (
        SELECT "customerId",
               date_trunc('month', MIN("createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS cohort
        FROM "orders" WHERE ${where} GROUP BY "customerId"
      ),
      activity AS (
        SELECT DISTINCT "customerId",
               date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS active_month
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
      where: { customerId, status: { notIn: VOID_LIKE } },
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

  async depotCustomerAggregates(depotId: string): Promise<DepotCustomerAggregate[]> {
    /*
     * One aggregate row per customer who has ordered at this depot (CANCELLED excluded).
     *
     * §I: the anonymous sentinel is excluded HERE, not in the caller. Every counter sale
     * with no phone shares `ANONYMOUS_CUSTOMER_ID`, so it grouped into one row with the
     * order count of the whole depot's walk-in trade — and `getCrmDashboard` iterates these
     * rows directly, which is how "Pelanggan walk-in / -" was being counted as a single,
     * very loyal, repeat customer in the segment totals.
     */
    const grouped = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: {
        depotId,
        status: { notIn: VOID_LIKE },
        customerId: { not: ANONYMOUS_CUSTOMER_ID },
      },
      _count: { _all: true },
      _sum: { total: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    if (grouped.length === 0) return [];
    // Latest order per customer for the name/phone WA-follow-up snapshot — see
    // latestContactPerCustomer for why this is DISTINCT ON and not Prisma's `distinct`.
    const ids = grouped.map((g) => g.customerId);
    const contacts = await this.latestContactPerCustomer(ids, depotId);
    const contactBy = new Map(contacts.map((c) => [c.customerId, c]));
    return grouped.map((g) => ({
      customerId: g.customerId,
      name: contactBy.get(g.customerId)?.recipientName ?? null,
      phone: contactBy.get(g.customerId)?.phone ?? null,
      orderCount: g._count._all,
      totalSpent: g._sum.total ? g._sum.total.toNumber() : 0,
      firstOrderAt: g._min.createdAt,
      lastOrderAt: g._max.createdAt,
    }));
  }

  async audienceReach(depotId?: string): Promise<number> {
    const conds: Prisma.Sql[] = [NOT_VOID_SQL];
    if (depotId) conds.push(Prisma.sql`"depotId" = ${depotId}::uuid`);
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "customerId")::bigint AS count
      FROM "orders"
      WHERE ${Prisma.join(conds, ' AND ')}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Every depot report is built from this, and it used to be one unbounded `findMany`
   * with the full item/history include — the cost of a report was whatever that depot
   * had ever sold (audit H-46).
   *
   * It still returns the whole window, because a report over part of a month is wrong,
   * not slower. What changed is how: a keyset walk in fixed pages, so peak memory is one
   * page rather than the result set, and a hard ceiling that REFUSES instead of quietly
   * returning a partial month.
   */
  async ordersForCustomers(customerIds: string[], range: ReportRange): Promise<OrderRecord[]> {
    // An empty set would make `in: []` match nothing, but asking the database that at all
    // is a round trip for an answer the caller already has.
    if (customerIds.length === 0) return [];
    const createdAt = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
    const where = {
      customerId: { in: customerIds },
      ...(range.from || range.to ? { createdAt } : {}),
    };

    const rows = await readAllPages(
      ({ take, cursor }) =>
        this.prisma.order.findMany({
          where,
          include: INCLUDE_NO_HISTORY,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      // The same ceiling `ordersForDepot` carries. A wider predicate must not come with a
      // weaker bound — that is how a report query becomes an unbounded scan by accident.
      {
        pageSize: REPORT_PAGE_SIZE,
        max: MAX_REPORT_ORDERS,
        onOverflow: () => {
          throw new ReportRangeTooLargeError(MAX_REPORT_ORDERS);
        },
      },
    );
    return rows.map((row) => this.toRecord(row));
  }

  async ordersForDepot(depotId: string, range: ReportRange): Promise<OrderRecord[]> {
    const createdAt = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
    const where = { depotId, ...(range.from || range.to ? { createdAt } : {}) };

    const rows = await readAllPages(
      ({ take, cursor }) =>
        this.prisma.order.findMany({
          where,
          include: INCLUDE_NO_HISTORY,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      {
        pageSize: REPORT_PAGE_SIZE,
        max: MAX_REPORT_ORDERS,
        onOverflow: () => {
          throw new ReportRangeTooLargeError(MAX_REPORT_ORDERS);
        },
      },
    );
    return rows.map((r) => this.toRecord(r));
  }

  /**
   * The predicates behind both segment reads. They are two queries — a count must not
   * materialise ids, an id list must not be re-counted — but they are ONE segment, and a
   * campaign sized by the count then broadcast to the ids is exactly where a silent
   * disagreement would show up as customers who never got the message.
   *
   * Depot scopes WHERE (so frequency/recency are computed over that depot's orders);
   * frequency/recency are HAVING predicates over the per-customer aggregate.
   */
  private segmentPredicates(conditions: SegmentConditions): {
    where: Prisma.Sql;
    having: Prisma.Sql;
  } {
    const where: Prisma.Sql[] = [NOT_VOID_SQL];
    if (conditions.depotId) where.push(Prisma.sql`"depotId" = ${conditions.depotId}::uuid`);
    const having: Prisma.Sql[] = [];
    if (conditions.minOrders != null) having.push(Prisma.sql`COUNT(*) >= ${conditions.minOrders}`);
    if (conditions.recencyCutoff)
      having.push(Prisma.sql`MAX("createdAt") >= ${conditions.recencyCutoff}`);
    if (conditions.lapsedCutoff)
      having.push(Prisma.sql`MAX("createdAt") < ${conditions.lapsedCutoff}`);
    if (conditions.firstOrderCutoff)
      having.push(Prisma.sql`MIN("createdAt") >= ${conditions.firstOrderCutoff}`);
    return {
      where: Prisma.join(where, ' AND '),
      having: having.length ? Prisma.sql`HAVING ${Prisma.join(having, ' AND ')}` : Prisma.empty,
    };
  }

  async segmentEstimate(conditions: SegmentConditions): Promise<number> {
    const { where, having } = this.segmentPredicates(conditions);
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT "customerId"
        FROM "orders"
        WHERE ${where}
        GROUP BY "customerId"
        ${having}
      ) t
    `);
    return Number(rows[0]?.count ?? 0);
  }

  async segmentCustomerIds(conditions: SegmentConditions, limit: number): Promise<string[]> {
    const { where, having } = this.segmentPredicates(conditions);
    // Ordered by id so the page is stable, and LIMITed so one segment can never return a
    // whole customer base in a single response. The caller decides what a full page means.
    const rows = await this.prisma.$queryRaw<{ customerId: string }[]>(Prisma.sql`
      SELECT "customerId"
      FROM "orders"
      WHERE ${where}
      GROUP BY "customerId"
      ${having}
      ORDER BY "customerId"
      LIMIT ${limit}
    `);
    return rows.map((r) => r.customerId);
  }
}
