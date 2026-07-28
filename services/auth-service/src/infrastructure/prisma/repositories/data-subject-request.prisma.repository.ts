import { Injectable } from '@nestjs/common';

import {
  AnonymisedIdentity,
  DataSubjectRequestRecord,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '../../../domain/data-subject/data-subject-request';
import {
  CreateDataSubjectRequestData,
  DataSubjectRequestRepository,
  DecideDataSubjectRequestData,
} from '../../../application/ports/data-subject-request.repository';
import { PrismaService } from '../prisma.service';

type Row = {
  id: string;
  customerId: string;
  type: string;
  status: string;
  reason: string | null;
  requestedAt: Date;
  processedBy: string | null;
  processedAt: Date | null;
};

@Injectable()
export class DataSubjectRequestPrismaRepository implements DataSubjectRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDataSubjectRequestData): Promise<DataSubjectRequestRecord> {
    return this.toRecord(await this.prisma.dataSubjectRequest.create({ data }));
  }

  async findById(id: string): Promise<DataSubjectRequestRecord | null> {
    const row = await this.prisma.dataSubjectRequest.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async listByCustomer(customerId: string): Promise<DataSubjectRequestRecord[]> {
    const rows = await this.prisma.dataSubjectRequest.findMany({
      where: { customerId },
      orderBy: { requestedAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findOpen(
    customerId: string,
    type: DataSubjectRequestType,
  ): Promise<DataSubjectRequestRecord | null> {
    const row = await this.prisma.dataSubjectRequest.findFirst({
      where: { customerId, type, status: 'PENDING' },
    });
    return row ? this.toRecord(row) : null;
  }

  async listForStaff(status?: DataSubjectRequestStatus): Promise<DataSubjectRequestRecord[]> {
    const rows = await this.prisma.dataSubjectRequest.findMany({
      where: status ? { status } : undefined,
      // PENDING before decided rows, and within each group the longest wait first —
      // a queue sorted by "newest" buries the request that has waited the longest.
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
    });
    return rows.map((r) => this.toRecord(r));
  }

  async decide(data: DecideDataSubjectRequestData): Promise<DataSubjectRequestRecord> {
    const row = await this.prisma.dataSubjectRequest.update({
      // The status guard is the real defence: two concurrent approvals cannot both win,
      // so the deletion never runs twice.
      where: { id: data.id, status: 'PENDING' },
      data: {
        status: data.status,
        processedBy: data.processedBy,
        processedAt: new Date(),
        reason: data.reason ?? undefined,
      },
    });
    return this.toRecord(row);
  }

  /**
   * One transaction: identifiers destroyed, account marked DELETED, every session
   * revoked. A half-applied anonymisation would leave a logged-in session on an
   * account whose owner asked to be forgotten.
   */
  async anonymiseCustomer(customerId: string, identity: AnonymisedIdentity): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: customerId },
        data: { ...identity, status: 'DELETED' },
      }),
      this.prisma.refreshToken.deleteMany({ where: { customerId } }),
    ]);
  }

  private toRecord(row: Row): DataSubjectRequestRecord {
    return {
      ...row,
      type: row.type as DataSubjectRequestType,
      status: row.status as DataSubjectRequestStatus,
    };
  }
}
