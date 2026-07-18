import { Injectable } from '@nestjs/common';

import {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '../../domain/order-dispute';
import {
  CreateDisputeData,
  DisputeRepository,
  UpdateDisputeData,
} from '../../application/ports/dispute.repository';
import { PrismaService } from './prisma.service';

interface DisputeRow {
  id: string;
  depotId: string;
  orderRef: string;
  customerName: string;
  category: string;
  description: string;
  amountIdr: number;
  courierName: string | null;
  status: string;
  resolution: string | null;
  resolutionNote: string | null;
  raisedBy: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class DisputePrismaRepository implements DisputeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: DisputeRow): OrderDispute {
    return {
      ...row,
      category: row.category as DisputeCategory,
      status: row.status as DisputeStatus,
      resolution: (row.resolution as DisputeResolution | null) ?? null,
    };
  }

  async create(data: CreateDisputeData): Promise<OrderDispute> {
    const row = await this.prisma.orderDispute.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string, status?: DisputeStatus): Promise<OrderDispute[]> {
    const rows = await this.prisma.orderDispute.findMany({
      where: { depotId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<OrderDispute | null> {
    const row = await this.prisma.orderDispute.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async update(id: string, data: UpdateDisputeData): Promise<OrderDispute> {
    const row = await this.prisma.orderDispute.update({ where: { id }, data });
    return this.toRecord(row);
  }
}
