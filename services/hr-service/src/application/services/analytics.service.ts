import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser, depotScopeFilter } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { toCsv } from '../../domain/csv';
import {
  ANALYTICS_REPOSITORY,
  AnalyticsRepository,
  GroupCount,
} from '../ports/analytics.repository';

const dec = (d: Prisma.Decimal | null): number => (d ? d.toNumber() : 0);
const isoDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');
const isoTime = (d: Date | null): string => (d ? d.toISOString() : '');

export interface HrDashboard {
  depotId: string | null;
  periodMonth: string;
  workDate: string;
  headcount: { total: number; byStatus: GroupCount[]; byEmploymentStatus: GroupCount[] };
  attendanceToday: GroupCount[];
  payroll: {
    totals: { gross: number; totalBonus: number; totalDeduction: number; net: number; count: number };
    byStatus: GroupCount[];
  };
}

/** HR dashboard aggregations + CSV report exports. All read-only; depot-scoped for locked roles. */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_REPOSITORY) private readonly repo: AnalyticsRepository,
    private readonly config: HrConfigService,
  ) {}

  async dashboard(
    user: AuthenticatedUser,
    query: { depotId?: string; periodMonth?: string },
  ): Promise<HrDashboard> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const workDate = this.today();
    const periodMonth = query.periodMonth ?? workDate.slice(0, 7);
    const workDateUtc = new Date(`${workDate}T00:00:00.000Z`);

    const [byStatus, byEmploymentStatus, attendanceToday, payrollTotals, payrollByStatus] =
      await Promise.all([
        this.repo.headcountByStatus(depotId),
        this.repo.headcountByEmploymentStatus(depotId),
        this.repo.attendanceByStatus(workDateUtc, depotId),
        this.repo.payrollTotals(periodMonth, depotId),
        this.repo.payrollByStatus(periodMonth, depotId),
      ]);

    return {
      depotId: depotId ?? null,
      periodMonth,
      workDate,
      headcount: {
        total: byStatus.reduce((sum, g) => sum + g.count, 0),
        byStatus,
        byEmploymentStatus,
      },
      attendanceToday,
      payroll: { totals: payrollTotals, byStatus: payrollByStatus },
    };
  }

  async employeesCsv(user: AuthenticatedUser, depotIdParam?: string): Promise<string> {
    const depotId = depotScopeFilter(user, depotIdParam) ?? undefined;
    const rows = await this.repo.employeesForReport(depotId);
    return toCsv(
      ['employeeCode', 'fullName', 'phone', 'email', 'position', 'employmentStatus', 'salaryType', 'dailyRate', 'monthlyRate', 'status', 'joinDate'],
      rows.map((e) => [
        e.employeeCode, e.fullName, e.phone, e.email, e.position, e.employmentStatus,
        e.salaryType, dec(e.dailyRate), dec(e.monthlyRate), e.status, isoDate(e.joinDate),
      ]),
    );
  }

  async attendanceCsv(
    user: AuthenticatedUser,
    query: { depotId?: string; from: string; to: string },
  ): Promise<string> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const rows = await this.repo.attendanceForReport(new Date(query.from), new Date(query.to), depotId);
    return toCsv(
      ['workDate', 'employeeCode', 'fullName', 'status', 'checkInAt', 'checkOutAt', 'lateMinutes', 'workingMinutes'],
      rows.map((a) => [
        isoDate(a.workDate), a.employee.employeeCode, a.employee.fullName, a.status,
        isoTime(a.checkInAt), isoTime(a.checkOutAt), a.lateMinutes, a.workingMinutes ?? '',
      ]),
    );
  }

  async payrollCsv(user: AuthenticatedUser, query: { depotId?: string; periodMonth: string }): Promise<string> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const rows = await this.repo.payrollForReport(query.periodMonth, depotId);
    return toCsv(
      ['periodMonth', 'employeeCode', 'fullName', 'status', 'gross', 'totalBonus', 'totalDeduction', 'net', 'presentDays'],
      rows.map((p) => [
        p.periodMonth, p.employee.employeeCode, p.employee.fullName, p.status,
        dec(p.gross), dec(p.totalBonus), dec(p.totalDeduction), dec(p.net), p.presentDays,
      ]),
    );
  }

  /** Local (Asia/Jakarta) calendar date as YYYY-MM-DD. Mirrors attendance.service's day boundary. */
  private today(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}
