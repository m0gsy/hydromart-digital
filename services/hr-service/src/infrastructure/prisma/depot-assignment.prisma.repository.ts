import { Injectable } from '@nestjs/common';

import { EmployeeDepotAssignment, Prisma } from '../../../prisma/generated/client';
import {
  DepotAssignmentListFilter,
  DepotAssignmentRepository,
  DepotAssignmentWrite,
  OPEN_STATUSES,
} from '../../application/ports/depot-assignment.repository';
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
        },
      });
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
