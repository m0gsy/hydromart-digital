import { Injectable } from '@nestjs/common';

import {
  CreatePolicyChangeData,
  PolicyChangeKind,
  PolicyChangeRecord,
  PolicyChangeRepository,
  PolicyChangeStatus,
} from '../../application/ports/policy-change.repository';
import { PrismaService } from './prisma.service';

type Row = {
  id: string;
  kind: string;
  targetId: string | null;
  payload: unknown;
  status: string;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
};

function toRecord(row: Row): PolicyChangeRecord {
  return {
    ...row,
    kind: row.kind as PolicyChangeKind,
    status: row.status as PolicyChangeStatus,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  };
}

@Injectable()
export class PolicyChangePrismaRepository implements PolicyChangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreatePolicyChangeData): Promise<PolicyChangeRecord> {
    return toRecord(
      await this.prisma.policyChangeRequest.create({
        data: { ...data, payload: data.payload as never },
      }),
    );
  }

  async findById(id: string): Promise<PolicyChangeRecord | null> {
    const row = await this.prisma.policyChangeRequest.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async list(status: PolicyChangeStatus | undefined, take: number): Promise<PolicyChangeRecord[]> {
    const rows = await this.prisma.policyChangeRequest.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'desc' },
      take,
    });
    return rows.map(toRecord);
  }

  async decideIfPending(
    id: string,
    decision: { status: 'APPLIED' | 'REJECTED'; decidedBy: string; decisionNote: string | null },
  ): Promise<PolicyChangeRecord | null> {
    const { count } = await this.prisma.policyChangeRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { ...decision, decidedAt: new Date() },
    });
    if (count === 0) return null;
    return this.findById(id);
  }

  async reopen(id: string): Promise<void> {
    await this.prisma.policyChangeRequest.updateMany({
      where: { id },
      data: { status: 'PENDING', decidedBy: null, decidedAt: null, decisionNote: null },
    });
  }
}
