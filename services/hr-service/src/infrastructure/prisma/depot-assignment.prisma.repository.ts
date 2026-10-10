import { Injectable } from '@nestjs/common';

import { EmployeeDepotAssignment, Prisma } from '../../../prisma/generated/client';
import {
  DepotAssignmentListFilter,
  DepotAssignmentRepository,
  DepotAssignmentWrite,
  OPEN_STATUSES,
} from '../../application/ports/depot-assignment.repository';
import type { DepotMove } from '../../domain/depot-on';
import { PrismaService } from './prisma.service';

const asDate = (key: string): Date => new Date(`${key}T00:00:00.000Z`);

@Injectable()
export class DepotAssignmentPrismaRepository implements DepotAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createChecked(
    data: DepotAssignmentWrite,
    check: (open: EmployeeDepotAssignment[]) => void,
  ): Promise<EmployeeDepotAssignment> {
    return this.prisma.$transaction(async (tx) => {
      // The employee row is the mutex: every planner for this person waits here.
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${data.employeeId}::uuid FOR UPDATE`;
      const open = await tx.employeeDepotAssignment.findMany({
        where: { employeeId: data.employeeId, status: { in: [...OPEN_STATUSES] } },
      });
      check(open);
      return tx.employeeDepotAssignment.create({
        data: {
          employeeId: data.employeeId,
          kind: data.kind,
          depotId: data.depotId,
          startDate: asDate(data.startDate),
          endDate: data.endDate ? asDate(data.endDate) : null,
          createdByRole: data.createdByRole,
          createdBy: data.createdBy,
          note: data.note,
          ...(data.status ? { status: data.status } : {}),
        },
      });
    });
  }

  async decideRequested(
    id: string,
    to: 'PLANNED' | 'CANCELLED',
    check: ((open: EmployeeDepotAssignment[]) => void) | null,
    patch: { failReason?: string | null },
  ): Promise<EmployeeDepotAssignment | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.employeeDepotAssignment.findUnique({ where: { id } });
      if (!row || row.status !== 'REQUESTED') return null;
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${row.employeeId}::uuid FOR UPDATE`;
      if (check) {
        const open = await tx.employeeDepotAssignment.findMany({
          where: { employeeId: row.employeeId, status: { in: [...OPEN_STATUSES] } },
        });
        check(open);
      }
      // The status guard repeats the read: a concurrent decision that slipped in between
      // leaves zero rows touched and the caller a clean "decided already".
      const done = await tx.employeeDepotAssignment.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: to, ...(patch.failReason !== undefined ? { failReason: patch.failReason } : {}) },
      });
      return done.count === 1 ? tx.employeeDepotAssignment.findUnique({ where: { id } }) : null;
    });
  }

  async timelineFor(employeeId: string): Promise<DepotMove[]> {
    const moves = await this.prisma.employeeDepotMove.findMany({
      where: { employeeId },
      orderBy: { seq: 'asc' },
      take: 1000,
    });
    const loanIds = moves
      .filter((m) => m.kind === 'LOAN_START' && m.assignmentId)
      .map((m) => m.assignmentId as string);
    const ends = new Map<string, Date | null>();
    if (loanIds.length > 0) {
      const rows = await this.prisma.employeeDepotAssignment.findMany({
        where: { id: { in: loanIds } },
        select: { id: true, endDate: true },
        take: loanIds.length,
      });
      for (const r of rows) ends.set(r.id, r.endDate);
    }
    return moves.map((m) => {
      const end = m.assignmentId ? ends.get(m.assignmentId) : null;
      return {
        kind: m.kind,
        // @db.Date is UTC midnight, so its first ten characters ARE the local day.
        // tz-ok: @db.Date - the UTC slice IS the local day
        effectiveDate: m.effectiveDate.toISOString().slice(0, 10),
        seq: m.seq,
        fromDepotId: m.fromDepotId,
        toDepotId: m.toDepotId,
        // tz-ok: @db.Date - the UTC slice IS the local day
        loanEndDate: end ? end.toISOString().slice(0, 10) : null,
      };
    });
  }

  findById(id: string): Promise<EmployeeDepotAssignment | null> {
    return this.prisma.employeeDepotAssignment.findUnique({ where: { id } });
  }

  async hasOpen(employeeId: string): Promise<boolean> {
    const n = await this.prisma.employeeDepotAssignment.count({
      where: { employeeId, status: { in: [...OPEN_STATUSES] } },
    });
    return n > 0;
  }

  async list(
    filter: DepotAssignmentListFilter,
  ): Promise<{ rows: EmployeeDepotAssignment[]; total: number }> {
    const where: Prisma.EmployeeDepotAssignmentWhereInput = {
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.createdBy ? { createdBy: filter.createdBy } : {}),
      ...(filter.depotIds
        ? {
            OR: [
              { depotId: { in: [...filter.depotIds] } },
              { employee: { homeDepotId: { in: [...filter.depotIds] } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employeeDepotAssignment.findMany({
        where,
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employeeDepotAssignment.count({ where }),
    ]);
    return { rows, total };
  }

  findDue(today: string, limit: number): Promise<EmployeeDepotAssignment[]> {
    return this.prisma.employeeDepotAssignment.findMany({
      where: {
        OR: [
          { status: 'PLANNED', startDate: { lte: asDate(today) } },
          { status: 'ACTIVE', kind: 'LOAN', endDate: { lt: asDate(today) } },
        ],
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
  }

  async recordFailure(id: string, reason: string, maxAttempts: number): Promise<void> {
    const row = await this.prisma.employeeDepotAssignment.update({
      where: { id },
      data: { attempts: { increment: 1 }, failReason: reason.slice(0, 500) },
    });
    // Only a row that was still waiting to start gives up; a running loan that cannot be
    // returned keeps being retried, because leaving it ACTIVE is the safe state.
    if (row.status === 'PLANNED' && row.attempts >= maxAttempts) {
      await this.prisma.employeeDepotAssignment.updateMany({
        where: { id, status: 'PLANNED' },
        data: { status: 'FAILED' },
      });
    }
  }

  async cancelPlanned(id: string): Promise<EmployeeDepotAssignment | null> {
    const { count } = await this.prisma.employeeDepotAssignment.updateMany({
      where: { id, status: 'PLANNED' },
      data: { status: 'CANCELLED' },
    });
    return count === 0 ? null : this.prisma.employeeDepotAssignment.findUnique({ where: { id } });
  }
}
