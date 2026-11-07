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
  customerId: string | null;
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

  /**
   * DPT-2: erase one person from every row this service holds them in.
   *
   * Three tables, keyed three ways. A dispute carries the account id (null for a walk-in at
   * the counter); an incident only ever carries the number the operator wrote down; a
   * subscription carries the id. So the match is by id where there is one and by phone where
   * there is not, and both are tried.
   *
   * The ROWS stay. How many disputes a depot received, how they were resolved, and what a
   * standing order was for is the depot's operating record — it belongs to nobody's
   * identity. What goes is the person: the name, the number, and the free text they are
   * named in. `description` is scrubbed with the name because it is where the complaint
   * actually says who and where ("galon bocor di Jl. Melati 7, hub 0812…").
   */
  async erasePerson(customerId: string, phone: string | null): Promise<number> {
    const TOMBSTONE = 'Pengguna dihapus';
    const SCRUBBED = '[dihapus atas permintaan pemilik data]';
    const [disputes, incidents, subscriptions] = await this.prisma.$transaction([
      this.prisma.orderDispute.updateMany({
        where: { customerId },
        data: { customerName: TOMBSTONE, description: SCRUBBED },
      }),
      this.prisma.incident.updateMany({
        // No number on file matches no incident: an empty `in` says that outright.
        where: phone ? { customerPhone: phone } : { customerPhone: { in: [] } },
        data: { customerPhone: '-' },
      }),
      this.prisma.subscription.updateMany({
        where: { customerId },
        data: { customerName: TOMBSTONE },
      }),
    ]);
    return disputes.count + incidents.count + subscriptions.count;
  }

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

  async claimOpen(id: string, data: UpdateDisputeData): Promise<OrderDispute | null> {
    const { count } = await this.prisma.orderDispute.updateMany({
      where: { id, status: DisputeStatus.OPEN },
      data,
    });
    if (count === 0) return null;
    return this.findById(id);
  }
}
