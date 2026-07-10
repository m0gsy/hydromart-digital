import { Injectable } from '@nestjs/common';

import { OrderStatus } from '../../domain/order-status';
import {
  CreateOrderData,
  OrderQuery,
  OrderRecord,
  OrderRepository,
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
    const { items, ...order } = data;
    const row = await this.prisma.order.create({
      data: {
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
}
