import { Injectable } from '@nestjs/common';
import { nextCursor, pageArgs } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';

import { PaymentMethod, PaymentStatus, RefundApproval } from '../../domain/payment';
import {
  CashCollectedSummary,
  OrderCashRow,
  CreatePaymentData,
  DateRange,
  MoneyKind,
  MoneyOrderRow,
  PaymentQuery,
  PaymentRecord,
  PaymentRepository,
  PaymentStatusPatch,
  UnsettledAgingCell,
  UnsettledMethodAggregate,
} from '../../application/ports/payment.repository';
import { PaymentAlreadyExistsError } from '../../domain/errors';
import { PrismaService } from './prisma.service';

type Decimalish = { toNumber(): number };

/** Prisma unique-constraint violation (P2002), detected without importing the client namespace. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

interface MoneyRaw {
  orderId: string;
  counterDepotId: string | null;
  method: string;
  bucket: number | bigint;
  amount: Prisma.Decimal | null;
  count: bigint;
}

interface PaymentRow {
  id: string;
  orderId: string;
  customerId: string;
  method: string;
  status: string;
  amount: Decimalish;
  reference: string | null;
  instruction: string | null;
  gatewayData: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  refundReason: string | null;
  refundRequestedBy: string | null;
  refundDueAt: Date | null;
  refundedAmount: Decimalish | null;
  refundApproval: string;
  cashReceived: Decimalish | null;
  changeGiven: Decimalish | null;
  depotId: string | null;
  cashierShiftId: string | null;
  proofUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * HD-6 A3: what a payment still counts for as money kept. PAID counts whole; REFUNDED counts
 * what was NOT sent back (amount minus the refunded part), never below zero. A REFUNDED row with
 * no stated amount is a full refund and counts nothing. Callers restrict status to PAID/REFUNDED.
 */
const KEPT_AMOUNT = Prisma.sql`(CASE WHEN "status" = 'PAID' THEN "amount" ELSE GREATEST("amount" - COALESCE("refundedAmount", "amount"), 0) END)`;

const ACTIVE_STATUSES: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.PAID];

@Injectable()
export class PaymentPrismaRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: PaymentRow): PaymentRecord {
    return {
      id: row.id,
      orderId: row.orderId,
      customerId: row.customerId,
      method: row.method as PaymentMethod,
      status: row.status as PaymentStatus,
      amount: row.amount.toNumber(),
      reference: row.reference,
      instruction: row.instruction,
      gatewayData: row.gatewayData,
      paidAt: row.paidAt,
      failedAt: row.failedAt,
      refundedAt: row.refundedAt,
      refundReason: row.refundReason,
      refundRequestedBy: row.refundRequestedBy,
      refundDueAt: row.refundDueAt,
      refundedAmount: row.refundedAmount ? row.refundedAmount.toNumber() : null,
      refundApproval: row.refundApproval as RefundApproval,
      cashReceived: row.cashReceived ? row.cashReceived.toNumber() : null,
      changeGiven: row.changeGiven ? row.changeGiven.toNumber() : null,
      depotId: row.depotId,
      cashierShiftId: row.cashierShiftId,
      proofUrl: row.proofUrl,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreatePaymentData): Promise<PaymentRecord> {
    try {
      const row = await this.prisma.payment.create({ data });
      return this.toRecord(row);
    } catch (error) {
      // Audit DB-1: the partial unique index (one active PENDING/PAID payment per
      // order) is the real guard against the initiate() check-then-act race; the
      // loser of a concurrent double-initiate hits P2002 here — translate it to the
      // same conflict the pre-check raises so a race can never double-create.
      if (isUniqueViolation(error)) {
        throw new PaymentAlreadyExistsError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findActiveByOrder(orderId: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toRecord(row) : null;
  }

  async findStalePending(
    before: Date,
    methods: readonly PaymentMethod[],
    limit: number,
  ): Promise<PaymentRecord[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        method: { in: methods as PaymentMethod[] },
        createdAt: { lt: before },
      },
      // Oldest first: the sweep is bounded, so the rows that have been stuck longest are
      // the ones a bounded pass must reach.
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async findReminderDue(
    before: Date,
    after: Date,
    methods: readonly PaymentMethod[],
    limit: number,
  ): Promise<PaymentRecord[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        method: { in: methods as PaymentMethod[] },
        createdAt: { lt: before, gte: after },
        reminderSentAt: null,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async claimReminder(id: string): Promise<boolean> {
    // The predicate is the claim: of two sweeps racing for the same row, one sees count 1.
    const claimed = await this.prisma.payment.updateMany({
      where: { id, status: PaymentStatus.PENDING, reminderSentAt: null },
      data: { reminderSentAt: new Date() },
    });
    return claimed.count === 1;
  }

  async findUnconfirmedCandidates(
    before: Date,
    after: Date,
    methods: readonly PaymentMethod[],
    limit: number,
  ): Promise<PaymentRecord[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PAID,
        method: { in: methods as PaymentMethod[] },
        paidAt: { lt: before, gte: after },
        unconfirmedNotifiedAt: null,
      },
      orderBy: { paidAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async findPaidSince(after: Date, limit: number): Promise<PaymentRecord[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PAID,
        paidAt: { gte: after },
        refundApproval: { not: RefundApproval.PENDING },
      },
      orderBy: { paidAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async claimUnconfirmedNotice(id: string): Promise<boolean> {
    const claimed = await this.prisma.payment.updateMany({
      where: { id, unconfirmedNotifiedAt: null },
      data: { unconfirmedNotifiedAt: new Date() },
    });
    return claimed.count === 1;
  }

  async findByReference(reference: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findFirst({ where: { reference } });
    return row ? this.toRecord(row) : null;
  }

  async search(
    query: PaymentQuery,
  ): Promise<{ items: PaymentRecord[]; total: number; nextCursor: string | null }> {
    const where = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        // `id` last so the cursor cannot straddle two payments in the same millisecond.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
      nextCursor: nextCursor(rows, query.limit),
    };
  }

  async findByOrderIds(orderIds: string[]): Promise<PaymentRecord[]> {
    if (orderIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      // Newest first per order: a new attempt only exists because the previous one failed
      // or was cancelled, so the first row an order hits is its current truth.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toRecord(r));
  }

  async refundedTotalByDepot(
    depotIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (depotIds.length === 0) return out;
    const grouped = await this.prisma.payment.groupBy({
      by: ['depotId'],
      where: {
        depotId: { in: [...depotIds] },
        status: PaymentStatus.REFUNDED,
        refundedAt: { gte: from, lt: to },
      },
      _sum: { refundedAmount: true },
    });
    for (const g of grouped) {
      if (!g.depotId) continue;
      out.set(g.depotId, g._sum.refundedAmount ? Math.round(Number(g._sum.refundedAmount)) : 0);
    }
    return out;
  }

  async refundedByOrder(
    depotIds: readonly string[],
    from: Date,
    to: Date,
    take: number,
  ): Promise<{ depotId: string; orderId: string; refundedIdr: number }[]> {
    if (depotIds.length === 0) return [];
    const rows = await this.prisma.payment.findMany({
      where: {
        depotId: { in: [...depotIds] },
        status: PaymentStatus.REFUNDED,
        refundedAt: { gte: from, lt: to },
      },
      select: { depotId: true, orderId: true, refundedAmount: true },
      orderBy: { refundedAt: 'asc' },
      take,
    });
    return rows
      .filter((r) => r.depotId)
      .map((r) => ({
        depotId: r.depotId as string,
        orderId: r.orderId,
        refundedIdr: r.refundedAmount ? Math.round(Number(r.refundedAmount)) : 0,
      }));
  }

  async refundCountsByCustomer(
    from: Date,
    to: Date,
    minRefunds: number,
  ): Promise<{ customerId: string; refunds: number; amountIdr: number }[]> {
    // `refundedAt`, not `createdAt`: the window is about when money went back, not when the
    // payment was taken. A refund settled today on a payment from March belongs to today.
    const grouped = await this.prisma.payment.groupBy({
      by: ['customerId'],
      where: { status: PaymentStatus.REFUNDED, refundedAt: { gte: from, lte: to } },
      _sum: { refundedAmount: true },
      _count: { _all: true },
    });
    return grouped
      .filter((g) => g._count._all >= minRefunds)
      .map((g) => ({
        customerId: g.customerId,
        refunds: g._count._all,
        amountIdr: g._sum.refundedAmount ? Math.round(Number(g._sum.refundedAmount)) : 0,
      }))
      .sort((a, b) => b.refunds - a.refunds);
  }

  async listPendingRefunds(query: {
    page: number;
    limit: number;
  }): Promise<{ items: PaymentRecord[]; total: number }> {
    const where = { refundApproval: RefundApproval.PENDING };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
  }

  async aggregateUnsettledAging(
    asOf: Date,
    tz: string,
    maxDays: readonly number[],
  ): Promise<UnsettledAgingCell[]> {
    // One WHEN per boundary, each bound as a parameter: the buckets are defined once, in the
    // service, and this query cannot drift from them. The last bucket is "everything older".
    const cases = Prisma.join(
      maxDays.map((limit, i) => Prisma.sql`WHEN "age" <= ${limit}::int THEN ${i}::int`),
      ' ',
    );
    const rows = await this.prisma.$queryRaw<
      { method: string; bucket: number; amount: Prisma.Decimal | null; count: bigint }[]
    >(Prisma.sql`
      -- Age in whole calendar days in the business zone: "createdAt" is a naive timestamp that
      -- holds UTC, so label it UTC, then read it in the zone. A payment made at 03:00 WIB is
      -- UTC's yesterday, and aging it by the UTC date would make it a day older than it is.
      SELECT "method"::text AS method,
             CASE ${cases} ELSE ${maxDays.length}::int END AS bucket,
             COALESCE(SUM("amount"), 0) AS amount,
             COUNT(*)::bigint AS count
      FROM (
        SELECT "method", "amount",
               GREATEST(
                 0,
                 (${asOf}::timestamptz AT TIME ZONE ${tz})::date
                   - ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date
               ) AS "age"
        FROM "payments"
        WHERE "status" = ${PaymentStatus.PENDING}::"PaymentStatus"
      ) pending
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    return rows.map((r) => ({
      method: r.method as PaymentMethod,
      bucket: Number(r.bucket),
      amount: r.amount ? Number(r.amount) : 0,
      count: Number(r.count),
    }));
  }

  async aggregateUnsettledByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    const createdAt =
      range.from || range.to
        ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) }
        : undefined;
    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { status: PaymentStatus.PENDING, ...(createdAt ? { createdAt } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return grouped.map((g) => ({
      method: g.method as PaymentMethod,
      amount: g._sum.amount ? Number(g._sum.amount) : 0,
      count: g._count._all,
    }));
  }

  async aggregateRevenueByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    const rows = await this.prisma.$queryRaw<
      { method: string; amount: Prisma.Decimal | null; count: bigint }[]
    >(Prisma.sql`
      SELECT "method"::text AS method,
             COALESCE(SUM(${KEPT_AMOUNT}), 0) AS amount,
             COUNT(*) FILTER (WHERE ${KEPT_AMOUNT} > 0)::bigint AS count
      FROM "payments"
      WHERE "status" IN (${PaymentStatus.PAID}::"PaymentStatus", ${PaymentStatus.REFUNDED}::"PaymentStatus")
        ${range.from ? Prisma.sql`AND ("createdAt" AT TIME ZONE 'UTC') >= ${range.from}::timestamptz` : Prisma.empty}
        ${range.to ? Prisma.sql`AND ("createdAt" AT TIME ZONE 'UTC') <= ${range.to}::timestamptz` : Prisma.empty}
      GROUP BY "method"
      HAVING COUNT(*) FILTER (WHERE ${KEPT_AMOUNT} > 0) > 0
    `);
    return rows.map((r) => ({
      method: r.method as PaymentMethod,
      amount: r.amount ? Number(r.amount) : 0,
      count: Number(r.count),
    }));
  }

  async cashByOrder(orderIds: string[]): Promise<OrderCashRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    // One number per order, not a row per payment: an order can legitimately carry more than
    // one cash row (a partial settlement, a re-take after a void). A part-refunded row still
    // counts for what stayed (HD-6 A3); a fully refunded one drops out.
    const rows = await this.prisma.$queryRaw<{ orderId: string; amount: Prisma.Decimal }[]>(
      Prisma.sql`
      SELECT "orderId"::text AS "orderId", SUM(${KEPT_AMOUNT}) AS amount
      FROM "payments"
      WHERE "orderId" IN (${Prisma.join(orderIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND "method" = ${PaymentMethod.CASH}::"PaymentMethod"
        AND "status" IN (${PaymentStatus.PAID}::"PaymentStatus", ${PaymentStatus.REFUNDED}::"PaymentStatus")
      GROUP BY "orderId"
      HAVING SUM(${KEPT_AMOUNT}) > 0
    `,
    );
    return rows.map((r) => ({ orderId: r.orderId, amountIdr: Math.round(Number(r.amount)) }));
  }

  /**
   * C2: a shift asks for ITS OWN drawer.
   *
   * This was a depot plus a time window and nothing else, while concurrent shifts at one
   * depot are supported — so two cashiers open at once each claimed the whole window. The
   * same rupiah counted against both tills, one of them short by the other's takings, and
   * the counter cash posted to the cash book twice.
   *
   * The `cashierShiftId: null` arm is the GRANDFATHER, and it is not a loose end: every
   * counter payment taken before this column existed has no shift id, and dropping those
   * would turn a day of real takings into a shortfall against a real person. Attributing
   * them by the old window rule is exactly what happened to them before, so nothing moves.
   * Measured on production before writing this: two such payments exist, both inside a
   * single shift's window, none straddling two — so the arm is unambiguous today and only
   * ever shrinks.
   *
   * Called without a shift id, it is the old query, unchanged: the depot-wide daily report
   * genuinely wants every till at once.
   */
  async sumDepotCash(
    depotId: string,
    range: DateRange,
    cashierShiftId?: string,
  ): Promise<CashCollectedSummary> {
    const inWindow = Prisma.sql`"paidAt" IS NOT NULL
        ${range.from ? Prisma.sql`AND ("paidAt" AT TIME ZONE 'UTC') >= ${range.from}::timestamptz` : Prisma.empty}
        ${range.to ? Prisma.sql`AND ("paidAt" AT TIME ZONE 'UTC') <= ${range.to}::timestamptz` : Prisma.empty}`;
    const scope = cashierShiftId
      ? Prisma.sql`("cashierShiftId" = ${cashierShiftId} OR ("cashierShiftId" IS NULL AND ${inWindow}))`
      : inWindow;
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal; count: bigint }[]>(
      Prisma.sql`
      SELECT COALESCE(SUM(${KEPT_AMOUNT}), 0) AS total,
             COUNT(*) FILTER (WHERE ${KEPT_AMOUNT} > 0)::bigint AS count
      FROM "payments"
      WHERE "depotId" = ${depotId}::uuid
        AND "method" = ${PaymentMethod.CASH}::"PaymentMethod"
        AND "status" IN (${PaymentStatus.PAID}::"PaymentStatus", ${PaymentStatus.REFUNDED}::"PaymentStatus")
        AND ${scope}
    `,
    );
    return { total: Number(row.total), count: Number(row.count) };
  }

  async moneyByOrder(
    kind: MoneyKind,
    window: { from: Date; to: Date },
    limit: number,
    aging: { asOf: Date; tz: string; maxDays: readonly number[] },
  ): Promise<MoneyOrderRow[]> {
    // The columns are naive timestamps holding UTC: label them UTC, then compare as instants.
    const between = (column: string): Prisma.Sql =>
      Prisma.sql`("${Prisma.raw(column)}" AT TIME ZONE 'UTC') >= ${window.from}::timestamptz
        AND ("${Prisma.raw(column)}" AT TIME ZONE 'UTC') < ${window.to}::timestamptz`;
    const cases = Prisma.join(
      aging.maxDays.map((max, i) => Prisma.sql`WHEN "age" <= ${max}::int THEN ${i}::int`),
      ' ',
    );
    const rows =
      kind === 'pending'
        ? await this.prisma.$queryRaw<MoneyRaw[]>(Prisma.sql`
            SELECT "orderId"::text AS "orderId", "depotId"::text AS "counterDepotId", "method"::text AS method,
                   CASE ${cases} ELSE ${aging.maxDays.length}::int END AS bucket,
                   SUM("amount") AS amount, COUNT(*)::bigint AS count
            FROM (
              SELECT "orderId", "depotId", "method", "amount",
                     GREATEST(0, (${aging.asOf}::timestamptz AT TIME ZONE ${aging.tz})::date
                       - ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${aging.tz})::date) AS "age"
              FROM "payments"
              WHERE "status" = ${PaymentStatus.PENDING}::"PaymentStatus" AND ${between('createdAt')}
            ) pending
            GROUP BY 1, 2, 3, 4
            LIMIT ${limit}`)
        : kind === 'collected'
          ? await this.prisma.$queryRaw<MoneyRaw[]>(Prisma.sql`
              SELECT "orderId"::text AS "orderId", "depotId"::text AS "counterDepotId", "method"::text AS method,
                     0 AS bucket, SUM(${KEPT_AMOUNT}) AS amount,
                     COUNT(*) FILTER (WHERE ${KEPT_AMOUNT} > 0)::bigint AS count
              FROM "payments"
              WHERE "status" IN (${PaymentStatus.PAID}::"PaymentStatus", ${PaymentStatus.REFUNDED}::"PaymentStatus")
                AND "paidAt" IS NOT NULL AND ${between('paidAt')}
              GROUP BY 1, 2, 3
              HAVING SUM(${KEPT_AMOUNT}) > 0
              LIMIT ${limit}`)
          : await this.prisma.$queryRaw<MoneyRaw[]>(Prisma.sql`
              SELECT "orderId"::text AS "orderId", "depotId"::text AS "counterDepotId", "method"::text AS method,
                     0 AS bucket, SUM(COALESCE("refundedAmount", "amount")) AS amount, COUNT(*)::bigint AS count
              FROM "payments"
              WHERE "status" = ${PaymentStatus.REFUNDED}::"PaymentStatus"
                AND ("refundSettledAt" IS NOT NULL OR "refundedAt" < now() - interval '15 minutes')
                AND "refundedAt" IS NOT NULL AND ${between('refundedAt')}
              GROUP BY 1, 2, 3
              LIMIT ${limit}`);
    return rows.map((r) => ({
      orderId: r.orderId,
      counterDepotId: r.counterDepotId,
      method: r.method as PaymentMethod,
      bucket: Number(r.bucket),
      amountIdr: r.amount ? Math.round(Number(r.amount)) : 0,
      count: Number(r.count),
    }));
  }

  async refundedTotalForOrder(orderId: string): Promise<number> {
    // An unmarked row older than 15 minutes counts too: a claim lasts only as long as the gateway
    // call, so an older one was settled by code that predates the marker (or is stuck, which is
    // reconciled by hand). Otherwise a deploy window would drop real refunds for good.
    // Only SETTLED refunds: a row claimed by a refund still waiting on the gateway is REFUNDED
    // too, and may yet be handed back. A row with no stated part is a full refund (same rule as
    // KEPT_AMOUNT), so the two readers cannot disagree.
    const [row] = await this.prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT SUM(COALESCE("refundedAmount", "amount")) AS total
      FROM "payments"
      WHERE "orderId" = ${orderId}::uuid
        AND "status" = ${PaymentStatus.REFUNDED}::"PaymentStatus"
        AND ("refundSettledAt" IS NOT NULL OR "refundedAt" < now() - interval '15 minutes')
    `);
    return row?.total ? Math.round(Number(row.total)) : 0;
  }

  async attachProofIfFirst(
    id: string,
    proofUrl: string,
  ): Promise<{ record: PaymentRecord; attached: boolean }> {
    const { count } = await this.prisma.payment.updateMany({
      where: { id, proofUrl: null },
      data: { proofUrl },
    });
    const row = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    return { record: this.toRecord(row), attached: count === 1 };
  }

  async findProofsSettledBefore(
    cutoff: Date,
    limit: number,
  ): Promise<{ id: string; proofUrl: string }[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        proofUrl: { not: null },
        OR: [{ paidAt: { lt: cutoff } }, { paidAt: null, createdAt: { lt: cutoff } }],
      },
      select: { id: true, proofUrl: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.flatMap((r) => (r.proofUrl ? [{ id: r.id, proofUrl: r.proofUrl }] : []));
  }

  async clearProof(id: string): Promise<void> {
    await this.prisma.payment.update({ where: { id }, data: { proofUrl: null } });
  }

  async update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord> {
    const row = await this.prisma.payment.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }

  async updateIfStatus(
    id: string,
    expected: PaymentStatus[],
    patch: PaymentStatusPatch,
    onlyIf?: { refundApproval?: RefundApproval },
  ): Promise<PaymentRecord | null> {
    // updateMany carries the predicate; `update` cannot filter on anything but a unique
    // field, which is exactly why the old write matched on `id` alone (B-9).
    const claimed = await this.prisma.payment.updateMany({
      where: {
        id,
        status: { in: expected },
        ...(onlyIf?.refundApproval ? { refundApproval: onlyIf.refundApproval } : {}),
      },
      data: patch,
    });
    if (claimed.count === 0) return null;
    const row = await this.prisma.payment.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }
}
