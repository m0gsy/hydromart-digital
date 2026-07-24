import { Injectable } from '@nestjs/common';

import { Employee, Prisma } from '../../../prisma/generated/client';
import {
  AnalyticsRepository,
  AttendanceWithEmployee,
  GroupCount,
  PayrollTotals,
  PayrollWithEmployee,
} from '../../application/ports/analytics.repository';
import { PrismaService } from './prisma.service';

const EMPLOYEE_SUMMARY = { select: { employeeCode: true, fullName: true } } as const;

@Injectable()
export class AnalyticsPrismaRepository implements AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async headcountByStatus(depotId?: string): Promise<GroupCount[]> {
    const groups = await this.prisma.employee.groupBy({
      by: ['status'],
      where: { depotId },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.status, count: g._count._all }));
  }

  async headcountByEmploymentStatus(depotId?: string): Promise<GroupCount[]> {
    const groups = await this.prisma.employee.groupBy({
      by: ['employmentStatus'],
      where: { depotId, status: 'ACTIVE' },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.employmentStatus, count: g._count._all }));
  }

  async attendanceByStatus(workDate: Date, depotId?: string): Promise<GroupCount[]> {
    const groups = await this.prisma.attendance.groupBy({
      by: ['status'],
      where: { workDate, depotId },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.status, count: g._count._all }));
  }

  async payrollTotals(periodMonth: string, depotId?: string): Promise<PayrollTotals> {
    const agg = await this.prisma.payroll.aggregate({
      where: { periodMonth, ...(depotId ? { employee: { depotId } } : {}) },
      _sum: { gross: true, totalBonus: true, totalDeduction: true, net: true },
      _count: { _all: true },
    });
    const num = (d: Prisma.Decimal | null): number => (d ? d.toNumber() : 0);
    return {
      gross: num(agg._sum.gross),
      totalBonus: num(agg._sum.totalBonus),
      totalDeduction: num(agg._sum.totalDeduction),
      net: num(agg._sum.net),
      count: agg._count._all,
    };
  }

  async payrollByStatus(periodMonth: string, depotId?: string): Promise<GroupCount[]> {
    const groups = await this.prisma.payroll.groupBy({
      by: ['status'],
      where: { periodMonth, ...(depotId ? { employee: { depotId } } : {}) },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.status, count: g._count._all }));
  }

  employeesForReport(depotId?: string): Promise<Employee[]> {
    return this.prisma.employee.findMany({ where: { depotId }, orderBy: { employeeCode: 'asc' } });
  }

  attendanceForReport(from: Date, to: Date, depotId?: string): Promise<AttendanceWithEmployee[]> {
    return this.prisma.attendance.findMany({
      where: { workDate: { gte: from, lte: to }, depotId },
      include: { employee: EMPLOYEE_SUMMARY },
      orderBy: [{ workDate: 'asc' }, { employeeId: 'asc' }],
    });
  }

  payrollForReport(periodMonth: string, depotId?: string): Promise<PayrollWithEmployee[]> {
    return this.prisma.payroll.findMany({
      where: { periodMonth, ...(depotId ? { employee: { depotId } } : {}) },
      include: { employee: EMPLOYEE_SUMMARY },
      orderBy: { employee: { employeeCode: 'asc' } },
    });
  }
}
