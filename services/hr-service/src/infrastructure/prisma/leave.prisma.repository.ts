import { Injectable } from '@nestjs/common';

import { depotWhere } from '@hydromart/platform';

import { LeaveBalance, LeaveRequest, LeaveStatus } from '../../../prisma/generated/client';

import {
  LeaveDecision,
  LeaveListRow,
  LeaveListFilter,
  LeaveRepository,
  LeaveRequestWrite,
} from '../../application/ports/leave.repository';
import { PrismaService } from './prisma.service';


@Injectable()
export class LeavePrismaRepository implements LeaveRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: LeaveRequestWrite): Promise<LeaveRequest> {
    return this.prisma.leaveRequest.create({ data });
  }

  findById(id: string): Promise<LeaveRequest | null> {
    return this.prisma.leaveRequest.findUnique({ where: { id } });
  }

  async decide(
    id: string,
    fromStatus: LeaveStatus,
    decision: LeaveDecision,
  ): Promise<LeaveRequest | null> {
    // The status the caller read is part of the write: of two concurrent deciders only one matches.
    const { count } = await this.prisma.leaveRequest.updateMany({
      where: { id, status: fromStatus },
      data: decision,
    });
    return count === 0 ? null : this.prisma.leaveRequest.findUnique({ where: { id } });
  }

  async list(filter: LeaveListFilter): Promise<{ rows: LeaveListRow[]; total: number }> {
    const where = {
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.depotIds ? { depotId: depotWhere(filter.depotIds) } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        // PG-06: whose leave this is. One join on a relation this row already has.
        include: { employee: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return {
      rows: rows.map(({ employee, ...leave }) => ({
        ...leave,
        employeeName: employee?.fullName ?? null,
      })),
      total,
    };
  }

  listBlocking(employeeId: string, statuses: LeaveStatus[]): Promise<LeaveRequest[]> {
    return this.prisma.leaveRequest.findMany({
      where: { employeeId, status: { in: statuses } },
    });
  }

  findBalance(employeeId: string, year: number): Promise<LeaveBalance | null> {
    return this.prisma.leaveBalance.findUnique({
      where: { employeeId_year: { employeeId, year } },
    });
  }

  ensureBalance(employeeId: string, year: number, quotaDays: number): Promise<LeaveBalance> {
    // upsert with an empty update: a concurrent first request must not clobber usedDays.
    return this.prisma.leaveBalance.upsert({
      where: { employeeId_year: { employeeId, year } },
      create: { employeeId, year, quotaDays },
      update: {},
    });
  }

  async setBalance(
    employeeId: string,
    year: number,
    quotaDays: number,
    usedDays: number,
  ): Promise<{ balance: LeaveBalance; existed: boolean }> {
    const existing = await this.findBalance(employeeId, year);
    const balance = await this.prisma.leaveBalance.upsert({
      where: { employeeId_year: { employeeId, year } },
      create: { employeeId, year, quotaDays, usedDays },
      update: { quotaDays, usedDays },
    });
    return { balance, existed: existing !== null };
  }

  async claimUsedDays(employeeId: string, year: number, days: number): Promise<boolean> {
    // One statement: the bound is checked against the CURRENT row, so two approvals racing
    // for the last days cannot both fit.
    const changed = await this.prisma.$executeRaw`
      UPDATE leave_balances
      SET "usedDays" = "usedDays" + ${days}::int, "updatedAt" = now()
      WHERE "employeeId" = ${employeeId}::uuid AND "year" = ${year}::int
        AND "usedDays" + ${days}::int <= "quotaDays"`;
    return changed === 1;
  }

  async releaseUsedDays(employeeId: string, year: number, days: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE leave_balances
      SET "usedDays" = GREATEST("usedDays" - ${days}::int, 0), "updatedAt" = now()
      WHERE "employeeId" = ${employeeId}::uuid AND "year" = ${year}::int`;
  }
}
