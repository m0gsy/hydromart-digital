import { Injectable } from '@nestjs/common';

import { Employee, Prisma } from '../../../prisma/generated/client';
import {
  AnalyticsRepository,
  AnnouncementWithStats,
  AssetWithHolder,
  AttendanceWithEmployee,
  GroupCount,
  LeaveWithEmployee,
  PayrollTotals,
  PayrollWithEmployee,
  ReviewWithEmployee,
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
      // PENDING = offline punch still awaiting HR; it is not attendance yet.
      where: { workDate: { gte: from, lte: to }, depotId, status: { not: 'PENDING' } },
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

  // ── C4 reports ──────────────────────────────────────────────────────

  lateForReport(from: Date, to: Date, depotId?: string): Promise<AttendanceWithEmployee[]> {
    return this.prisma.attendance.findMany({
      // status LATE only: an ABSENT day has no arrival time to be late by.
      where: { workDate: { gte: from, lte: to }, depotId, status: 'LATE' },
      include: { employee: EMPLOYEE_SUMMARY },
      orderBy: [{ lateMinutes: 'desc' }, { workDate: 'asc' }],
    });
  }

  leaveForReport(from: Date, to: Date, depotId?: string): Promise<LeaveWithEmployee[]> {
    return this.prisma.leaveRequest.findMany({
      // Overlap, not containment: leave running across the window edge still belongs in it.
      where: { startDate: { lte: to }, endDate: { gte: from }, depotId },
      include: { employee: EMPLOYEE_SUMMARY },
      orderBy: [{ startDate: 'asc' }, { employeeId: 'asc' }],
    });
  }

  performanceForReport(periodMonth: string, depotId?: string): Promise<ReviewWithEmployee[]> {
    return this.prisma.performanceReview.findMany({
      where: { periodMonth, ...(depotId ? { employee: { depotId } } : {}) },
      include: { employee: EMPLOYEE_SUMMARY },
      orderBy: { score: 'desc' },
    });
  }

  assetsForReport(depotId?: string): Promise<AssetWithHolder[]> {
    return this.prisma.employeeAsset.findMany({
      where: { depotId },
      include: { holder: EMPLOYEE_SUMMARY },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
  }

  announcementsForReport(from: Date, to: Date): Promise<AnnouncementWithStats[]> {
    return this.prisma.announcement.findMany({
      where: { publishedAt: { gte: from, lte: to } },
      include: { targets: true, _count: { select: { reads: true } } },
      orderBy: { publishedAt: 'desc' },
    });
  }
}
