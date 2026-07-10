import { Injectable } from '@nestjs/common';

import { OrderStatus as DbOrderStatus, Prisma } from '../../../prisma/generated/client';
import { OrderStatus } from '../../domain/order-status';
import {
  CreateOrderData,
  CustomerSales,
  DepotSales,
  OrderQuery,
  OrderRecord,
  OrderRepository,
  ReportRange,
  SalesBucket,
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
  items: ItemRow[];
  history: HistoryRow[];
  createdAt: Date;
  updatedAt: Date;
}

const INCLUDE = {
  items: true,
  history: { orderBy: { createdAt: 'asc' as const } },
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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
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

  async applyStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
  ): Promise<OrderRecord> {
    const row = await this.prisma.order.update({
      where: { id },
      data: {
        status,
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
}
