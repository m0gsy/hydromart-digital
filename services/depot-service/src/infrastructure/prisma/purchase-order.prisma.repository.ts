import { Injectable } from '@nestjs/common';

import { PoLine, PoStatus, PurchaseOrder } from '../../domain/purchase-order';
import {
  CreatePurchaseOrderData,
  PurchaseOrderRepository,
  UpdatePurchaseOrderData,
} from '../../application/ports/purchase-order.repository';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

interface PurchaseOrderRow {
  id: string;
  depotId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  status: string;
  lines: unknown;
  subtotalIdr: number;
  shippingIdr: number;
  totalIdr: number;
  expectedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class PurchaseOrderPrismaRepository implements PurchaseOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: PurchaseOrderRow): PurchaseOrder {
    return {
      ...row,
      status: row.status as PoStatus,
      lines: (row.lines ?? []) as PoLine[],
    };
  }

  async create(data: CreatePurchaseOrderData): Promise<PurchaseOrder> {
    const row = await this.prisma.purchaseOrder.create({
      data: { ...data, lines: data.lines as unknown as Prisma.InputJsonValue },
    });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string, status?: PoStatus): Promise<PurchaseOrder[]> {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: { depotId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<PurchaseOrder | null> {
    const row = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async update(id: string, data: UpdatePurchaseOrderData): Promise<PurchaseOrder> {
    const row = await this.prisma.purchaseOrder.update({ where: { id }, data });
    return this.toRecord(row);
  }
}
