import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser, depotScopeFilter } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { CsvCell, toCsv } from '../../domain/csv';
import {
  ANALYTICS_REPOSITORY,
  AnalyticsRepository,
  GroupCount,
} from '../ports/analytics.repository';

export interface ReportData {
  headers: string[];
  rows: CsvCell[][];
}

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
    totals: {
      gross: number;
      totalBonus: number;
      totalDeduction: number;
      net: number;
      count: number;
    };
    byStatus: GroupCount[];
  };
}

/** Compact per-depot HR summary for the owner franchise dashboard (Fase 5). */
export interface HrDepotSummary {
  depotId: string;
  workDate: string;
  periodMonth: string;
  lateToday: number;
  absentToday: number;
  presentToday: number;
  /** Net payroll month-to-date (IDR) for the depot. */
  payrollMtdNet: number;
  activeHeadcount: number;
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

  /**
   * Compact per-depot HR summary (Fase 5) — late/absent today + payroll MTD net +
   * active headcount. No user scoping: the caller (dashboard-service BFF, internal key)
   * has already resolved the owner's depots and asks per depot.
   */
  async depotSummary(depotId: string): Promise<HrDepotSummary> {
    const workDate = this.today();
    const periodMonth = workDate.slice(0, 7);
    const workDateUtc = new Date(`${workDate}T00:00:00.000Z`);
    const [attendanceToday, payroll, headcount] = await Promise.all([
      this.repo.attendanceByStatus(workDateUtc, depotId),
      this.repo.payrollTotals(periodMonth, depotId),
      this.repo.headcountByStatus(depotId),
    ]);
    const count = (key: string): number => attendanceToday.find((g) => g.key === key)?.count ?? 0;
    return {
      depotId,
      workDate,
      periodMonth,
      lateToday: count('LATE'),
      absentToday: count('ABSENT'),
      presentToday: count('PRESENT'),
      payrollMtdNet: payroll.net,
      activeHeadcount: headcount.find((g) => g.key === 'ACTIVE')?.count ?? 0,
    };
  }

  async employeeReport(user: AuthenticatedUser, depotIdParam?: string): Promise<ReportData> {
    const depotId = depotScopeFilter(user, depotIdParam) ?? undefined;
    const rows = await this.repo.employeesForReport(depotId);
    return {
      headers: [
        'employeeCode',
        'fullName',
        'phone',
        'email',
        'position',
        'employmentStatus',
        'salaryType',
        'dailyRate',
        'monthlyRate',
        'status',
        'joinDate',
      ],
      rows: rows.map((e) => [
        e.employeeCode,
        e.fullName,
        e.phone,
        e.email,
        e.position,
        e.employmentStatus,
        e.salaryType,
        dec(e.dailyRate),
        dec(e.monthlyRate),
        e.status,
        isoDate(e.joinDate),
      ]),
    };
  }

  async attendanceReport(
    user: AuthenticatedUser,
    query: { depotId?: string; from: string; to: string },
  ): Promise<ReportData> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const rows = await this.repo.attendanceForReport(
      new Date(query.from),
      new Date(query.to),
      depotId,
    );
    return {
      headers: [
        'workDate',
        'employeeCode',
        'fullName',
        'status',
        'checkInAt',
        'checkOutAt',
        'lateMinutes',
        'workingMinutes',
      ],
      rows: rows.map((a) => [
        isoDate(a.workDate),
        a.employee.employeeCode,
        a.employee.fullName,
        a.status,
        isoTime(a.checkInAt),
        isoTime(a.checkOutAt),
        a.lateMinutes,
        a.workingMinutes ?? '',
      ]),
    };
  }

  async payrollReport(
    user: AuthenticatedUser,
    query: { depotId?: string; periodMonth: string },
  ): Promise<ReportData> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const rows = await this.repo.payrollForReport(query.periodMonth, depotId);
    return {
      headers: [
        'periodMonth',
        'employeeCode',
        'fullName',
        'status',
        'gross',
        'totalBonus',
        'totalDeduction',
        'net',
        'presentDays',
      ],
      rows: rows.map((p) => [
        p.periodMonth,
        p.employee.employeeCode,
        p.employee.fullName,
        p.status,
        dec(p.gross),
        dec(p.totalBonus),
        dec(p.totalDeduction),
        dec(p.net),
        p.presentDays,
      ]),
    };
  }

  // ── C4 reports ──────────────────────────────────────────────────────

  /** Only days somebody arrived late, worst first. An absence is not a lateness. */
  async lateReport(
    user: AuthenticatedUser,
    query: { depotId?: string; from: string; to: string },
  ): Promise<ReportData> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const rows = await this.repo.lateForReport(new Date(query.from), new Date(query.to), depotId);
    return {
      headers: ['workDate', 'employeeCode', 'fullName', 'checkInAt', 'lateMinutes'],
      rows: rows.map((a) => [
        isoDate(a.workDate),
        a.employee.employeeCode,
        a.employee.fullName,
        isoTime(a.checkInAt),
        a.lateMinutes,
      ]),
    };
  }

  async leaveReport(
    user: AuthenticatedUser,
    query: { depotId?: string; from: string; to: string },
  ): Promise<ReportData> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const rows = await this.repo.leaveForReport(new Date(query.from), new Date(query.to), depotId);
    return {
      headers: [
        'employeeCode',
        'fullName',
        'type',
        'startDate',
        'endDate',
        'workingDays',
        'status',
        'reason',
        'decisionNote',
      ],
      rows: rows.map((l) => [
        l.employee.employeeCode,
        l.employee.fullName,
        l.type,
        isoDate(l.startDate),
        isoDate(l.endDate),
        l.workingDays,
        l.status,
        l.reason,
        l.decisionNote ?? '',
      ]),
    };
  }

  async performanceReport(
    user: AuthenticatedUser,
    query: { depotId?: string; periodMonth: string },
  ): Promise<ReportData> {
    const depotId = depotScopeFilter(user, query.depotId) ?? undefined;
    const rows = await this.repo.performanceForReport(query.periodMonth, depotId);
    return {
      headers: [
        'periodMonth',
        'employeeCode',
        'fullName',
        'score',
        'attendanceScore',
        'disciplineScore',
        'salesScore',
        'managerNote',
      ],
      rows: rows.map((r) => [
        r.periodMonth,
        r.employee.employeeCode,
        r.employee.fullName,
        dec(r.score),
        // Blank, not 0: the component had nothing to measure that period (C2).
        r.attendanceScore === null ? '' : r.attendanceScore.toNumber(),
        r.disciplineScore === null ? '' : r.disciplineScore.toNumber(),
        r.salesScore === null ? '' : r.salesScore.toNumber(),
        r.managerNote ?? '',
      ]),
    };
  }

  async assetReport(user: AuthenticatedUser, depotIdParam?: string): Promise<ReportData> {
    const depotId = depotScopeFilter(user, depotIdParam) ?? undefined;
    const rows = await this.repo.assetsForReport(depotId);
    return {
      headers: [
        'code',
        'type',
        'name',
        'brand',
        'serialNo',
        'value',
        'status',
        'holderCode',
        'holderName',
      ],
      rows: rows.map((a) => [
        a.code,
        a.type,
        a.name,
        a.brand ?? '',
        a.serialNo ?? '',
        dec(a.value),
        a.status,
        a.holder?.employeeCode ?? '',
        a.holder?.fullName ?? '',
      ]),
    };
  }

  async announcementReport(query: { from: string; to: string }): Promise<ReportData> {
    const rows = await this.repo.announcementsForReport(new Date(query.from), new Date(query.to));
    return {
      headers: [
        'publishedAt',
        'title',
        'level',
        'targets',
        'audienceSize',
        'readCount',
        'readRate',
      ],
      rows: rows.map((a) => [
        isoTime(a.publishedAt),
        a.title,
        a.level,
        a.targets.map((t) => `${t.dimension}${t.value ? `:${t.value}` : ''}`).join(' | '),
        a.audienceSize,
        a._count.reads,
        // Blank rather than 0% when it reached nobody — there is no rate to state.
        a.audienceSize > 0 ? `${Math.round((a._count.reads / a.audienceSize) * 100)}%` : '',
      ]),
    };
  }

  csv(report: ReportData): string {
    return toCsv(report.headers, report.rows);
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
