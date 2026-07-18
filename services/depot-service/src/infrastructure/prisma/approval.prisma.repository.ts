import { Injectable } from '@nestjs/common';

import {
  Approval,
  ApprovalPayload,
  ApprovalStatus,
  ApprovalType,
} from '../../domain/approval';
import {
  ApprovalRepository,
  CreateApprovalData,
  PendingCounts,
  UpdateApprovalData,
} from '../../application/ports/approval.repository';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

interface ApprovalRow {
  id: string;
  depotId: string;
  type: string;
  status: string;
  title: string;
  submittedBy: string;
  subjectRef: string | null;
  amountIdr: number;
  payload: unknown;
  autoPassThreshold: number;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class ApprovalPrismaRepository implements ApprovalRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ApprovalRow): Approval {
    return {
      ...row,
      type: row.type as ApprovalType,
      status: row.status as ApprovalStatus,
      payload: (row.payload ?? {}) as ApprovalPayload,
    };
  }

  async create(data: CreateApprovalData): Promise<Approval> {
    const row = await this.prisma.approval.create({
      data: { ...data, payload: data.payload as unknown as Prisma.InputJsonValue },
    });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string, status?: ApprovalStatus): Promise<Approval[]> {
    const rows = await this.prisma.approval.findMany({
      where: { depotId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<Approval | null> {
    const row = await this.prisma.approval.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async update(id: string, data: UpdateApprovalData): Promise<Approval> {
    const row = await this.prisma.approval.update({ where: { id }, data });
    return this.toRecord(row);
  }

  async pendingCounts(depotId: string): Promise<PendingCounts> {
    const grouped = await this.prisma.approval.groupBy({
      by: ['type'],
      where: { depotId, status: ApprovalStatus.PENDING },
      _count: { _all: true },
    });
    const counts: PendingCounts = {
      [ApprovalType.OPNAME_VARIANCE]: 0,
      [ApprovalType.DEPOSIT_REFUND]: 0,
      [ApprovalType.COD_VARIANCE]: 0,
    };
    for (const g of grouped) counts[g.type as ApprovalType] = g._count._all;
    return counts;
  }
}
