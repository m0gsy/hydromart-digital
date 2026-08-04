import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { depotWhere, readAllPages } from '@hydromart/platform';

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

/** Rows per keyset page while an export walks its window. */
const PAGE = 500;
/** Ceiling per export. Well past a year of one network's attendance, still one response. */
const MAX_EXPORT_ROWS = 50_000;

/** Keyset position for the next page. One place, so one branch to prove rather than eight. */
const fromCursor = (cursor?: string): { cursor?: { id: string }; skip?: number } =>
  cursor ? { cursor: { id: cursor }, skip: 1 } : {};

@Injectable()
export class AnalyticsPrismaRepository implements AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async headcountByStatus(depotIds?: readonly string[]): Promise<GroupCount[]> {
    const groups = await this.prisma.employee.groupBy({
      by: ['status'],
      where: { depotId: depotWhere(depotIds) },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.status, count: g._count._all }));
  }

  async headcountByEmploymentStatus(depotIds?: readonly string[]): Promise<GroupCount[]> {
    const groups = await this.prisma.employee.groupBy({
      by: ['employmentStatus'],
      where: { depotId: depotWhere(depotIds), status: 'ACTIVE' },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.employmentStatus, count: g._count._all }));
  }

  async attendanceByStatus(workDate: Date, depotIds?: readonly string[]): Promise<GroupCount[]> {
    const groups = await this.prisma.attendance.groupBy({
      by: ['status'],
      where: { workDate, depotId: depotWhere(depotIds) },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.status, count: g._count._all }));
  }

  async payrollTotals(periodMonth: string, depotIds?: readonly string[]): Promise<PayrollTotals> {
    const agg = await this.prisma.payroll.aggregate({
      where: { periodMonth, ...(depotIds ? { employee: { depotId: depotWhere(depotIds) } } : {}) },
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

  async payrollByStatus(periodMonth: string, depotIds?: readonly string[]): Promise<GroupCount[]> {
    const groups = await this.prisma.payroll.groupBy({
      by: ['status'],
      where: { periodMonth, ...(depotIds ? { employee: { depotId: depotWhere(depotIds) } } : {}) },
      _count: { _all: true },
    });
    return groups.map((g) => ({ key: g.status, count: g._count._all }));
  }

  /**
   * Every `…ForReport` read below feeds an HR export, which means it must return the
   * whole window — a payroll export missing rows 501-onwards is a wrong export, not a
   * slow one. They used to be plain unbounded findMany (audit H-43): a month of a
   * network's attendance is tens of thousands of rows in one response.
   *
   * So each walks by keyset in pages, with `id` as the final tiebreaker so the cursor is
   * deterministic, and refuses past MAX_EXPORT_ROWS instead of silently cutting the file
   * short.
   */
  private allPages<T extends { id: string }>(
    fetchPage: (args: { take: number; cursor?: string }) => Promise<T[]>,
  ): Promise<T[]> {
    return readAllPages(fetchPage, {
      pageSize: PAGE,
      max: MAX_EXPORT_ROWS,
      onOverflow: () => {
        throw new UnprocessableEntityException(
          `Laporan ini melebihi ${MAX_EXPORT_ROWS} baris. Persempit rentang atau filter depot.`,
        );
      },
    });
  }

  employeesForReport(depotIds?: readonly string[]): Promise<Employee[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.employee.findMany({
        where: { depotId: depotWhere(depotIds) },
        orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }

  attendanceForReport(from: Date, to: Date, depotIds?: readonly string[]): Promise<AttendanceWithEmployee[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.attendance.findMany({
        // PENDING = offline punch still awaiting HR; it is not attendance yet.
        where: { workDate: { gte: from, lte: to }, depotId: depotWhere(depotIds), status: { not: 'PENDING' } },
        include: { employee: EMPLOYEE_SUMMARY },
        orderBy: [{ workDate: 'asc' }, { employeeId: 'asc' }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }

  payrollForReport(periodMonth: string, depotIds?: readonly string[]): Promise<PayrollWithEmployee[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.payroll.findMany({
        where: { periodMonth, ...(depotIds ? { employee: { depotId: depotWhere(depotIds) } } : {}) },
        include: { employee: EMPLOYEE_SUMMARY },
        orderBy: [{ employee: { employeeCode: 'asc' } }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }

  // ── C4 reports ──────────────────────────────────────────────────────

  lateForReport(from: Date, to: Date, depotIds?: readonly string[]): Promise<AttendanceWithEmployee[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.attendance.findMany({
        // status LATE only: an ABSENT day has no arrival time to be late by.
        where: { workDate: { gte: from, lte: to }, depotId: depotWhere(depotIds), status: 'LATE' },
        include: { employee: EMPLOYEE_SUMMARY },
        orderBy: [{ lateMinutes: 'desc' }, { workDate: 'asc' }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }

  leaveForReport(from: Date, to: Date, depotIds?: readonly string[]): Promise<LeaveWithEmployee[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.leaveRequest.findMany({
        // Overlap, not containment: leave running across the window edge still belongs in it.
        where: { startDate: { lte: to }, endDate: { gte: from }, depotId: depotWhere(depotIds) },
        include: { employee: EMPLOYEE_SUMMARY },
        orderBy: [{ startDate: 'asc' }, { employeeId: 'asc' }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }

  performanceForReport(periodMonth: string, depotIds?: readonly string[]): Promise<ReviewWithEmployee[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.performanceReview.findMany({
        where: { periodMonth, ...(depotIds ? { employee: { depotId: depotWhere(depotIds) } } : {}) },
        include: { employee: EMPLOYEE_SUMMARY },
        orderBy: [{ score: 'desc' }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }

  assetsForReport(depotIds?: readonly string[]): Promise<AssetWithHolder[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.employeeAsset.findMany({
        where: { depotId: depotWhere(depotIds) },
        include: { holder: EMPLOYEE_SUMMARY },
        orderBy: [{ status: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }

  announcementsForReport(from: Date, to: Date): Promise<AnnouncementWithStats[]> {
    return this.allPages(({ take, cursor }) =>
      this.prisma.announcement.findMany({
        where: { publishedAt: { gte: from, lte: to } },
        include: { targets: true, _count: { select: { reads: true } } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take,
        ...fromCursor(cursor),
      }),
    );
  }
}
