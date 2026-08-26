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

  decide(id: string, decision: LeaveDecision): Promise<LeaveRequest> {
    return this.prisma.leaveRequest.update({ where: { id }, data: decision });
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

  addUsedDays(employeeId: string, year: number, days: number): Promise<LeaveBalance> {
    return this.prisma.leaveBalance.update({
      where: { employeeId_year: { employeeId, year } },
      data: { usedDays: { increment: days } },
    });
  }
}
