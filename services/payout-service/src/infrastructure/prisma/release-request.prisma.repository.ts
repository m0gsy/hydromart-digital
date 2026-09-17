import { Injectable } from '@nestjs/common';

import {
  CreateReleaseRequestData,
  ReleaseRequestRecord,
  ReleaseRequestRepository,
  ReleaseRequestStatus,
} from '../../application/ports/release-request.repository';
import { PrismaService } from './prisma.service';

interface RequestRow extends Omit<ReleaseRequestRecord, 'amountAtRequest' | 'status'> {
  amountAtRequest: unknown;
  status: string;
}

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class ReleaseRequestPrismaRepository implements ReleaseRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: RequestRow): ReleaseRequestRecord {
    return {
      id: row.id,
      franchiseOwnerId: row.franchiseOwnerId,
      bankAccountRef: row.bankAccountRef,
      amountAtRequest: Number(row.amountAtRequest),
      requestedBy: row.requestedBy,
      status: row.status as ReleaseRequestStatus,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      reason: row.reason,
      withdrawalId: row.withdrawalId,
      createdAt: row.createdAt,
    };
  }

  async create(data: CreateReleaseRequestData): Promise<ReleaseRequestRecord | null> {
    try {
      const row = await this.prisma.hqReleaseRequest.create({ data });
      return this.toRecord(row as unknown as RequestRow);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async findById(id: string): Promise<ReleaseRequestRecord | null> {
    const row = await this.prisma.hqReleaseRequest.findUnique({ where: { id } });
    return row ? this.toRecord(row as unknown as RequestRow) : null;
  }

  async listByStatus(status: ReleaseRequestStatus, limit: number): Promise<ReleaseRequestRecord[]> {
    const rows = await this.prisma.hqReleaseRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r as unknown as RequestRow));
  }

  async decide(
    id: string,
    data: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; reason: string | null },
  ): Promise<ReleaseRequestRecord | null> {
    // The PENDING guard is in the WHERE clause: two approvers cannot both win.
    const { count } = await this.prisma.hqReleaseRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { ...data, decidedAt: new Date() },
    });
    return count === 0 ? null : this.findById(id);
  }

  async attachWithdrawal(id: string, withdrawalId: string): Promise<ReleaseRequestRecord> {
    const row = await this.prisma.hqReleaseRequest.update({ where: { id }, data: { withdrawalId } });
    return this.toRecord(row as unknown as RequestRow);
  }

  async reopen(id: string): Promise<void> {
    await this.prisma.hqReleaseRequest.updateMany({
      where: { id, status: 'APPROVED', withdrawalId: null },
      data: { status: 'PENDING', decidedBy: null, decidedAt: null, reason: null },
    });
  }
}
