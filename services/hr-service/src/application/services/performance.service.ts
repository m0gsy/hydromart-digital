import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthenticatedUser, depotScopeIds } from '@hydromart/platform';

import { Employee, Prisma, PerformanceReview } from '../../../prisma/generated/client';
import { parseWeeklyOffDays, workingDaysInMonth } from '../../domain/calendar';
import {
  PerformanceScore,
  ScoreInputs,
  computePerformanceScore,
} from '../../domain/performance-score';
import { HrConfigService } from '../../config/hr-config.service';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { HOLIDAY_REPOSITORY, HolidayRepository } from '../ports/holiday.repository';
import { PERFORMANCE_REPOSITORY, PerformanceRepository } from '../ports/performance.repository';
import { SALES_PORT, SalesPort } from '../ports/sales.port';
import { EMPLOYEE_REPOSITORY, EmployeeRepository } from '../ports/employee.repository';
import { EmployeeService } from './employee.service';

/** How many staff one dashboard call will score. Beyond this the caller filters by depot. */
const DASHBOARD_LIMIT = 200;

export interface ScoredEmployee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  depotId: string;
  position: string;
  score: PerformanceScore;
  inputs: ScoreInputs;
}

/**
 * Monthly performance, one review per (employee, period).
 *
 * The score is computed from facts HR already holds — attendance for the period, lateness
 * within it, and the depot's sales via the same SalesPort the bonus rules use — with the
 * weights configurable per depot. The arithmetic itself lives in domain/performance-score.ts
 * so it stays testable without a database, and so an unmeasurable component drops out of the
 * average instead of scoring zero.
 */
@Injectable()
export class PerformanceService {
  constructor(
    @Inject(PERFORMANCE_REPOSITORY) private readonly repo: PerformanceRepository,
    private readonly employees: EmployeeService,
    @Inject(ATTENDANCE_REPOSITORY) private readonly attendance: AttendanceRepository,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeesRepo: EmployeeRepository,
    private readonly config: HrConfigService,
    @Optional() @Inject(HOLIDAY_REPOSITORY) private readonly holidays?: HolidayRepository,
    @Optional() @Inject(SALES_PORT) private readonly sales?: SalesPort,
  ) {}

  async upsert(
    user: AuthenticatedUser,
    input: {
      employeeId: string;
      periodMonth: string;
      score: number;
      metrics?: Record<string, unknown>;
      note?: string;
      managerNote?: string;
    },
  ): Promise<PerformanceReview> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    return this.repo.upsert({
      employeeId: input.employeeId,
      periodMonth: input.periodMonth,
      score: input.score,
      metrics: (input.metrics ?? {}) as Prisma.InputJsonValue,
      reviewerId: user.sub,
      note: input.note ?? null,
      ...(input.managerNote !== undefined ? { managerNote: input.managerNote } : {}),
    });
  }

  async listByEmployee(user: AuthenticatedUser, employeeId: string): Promise<PerformanceReview[]> {
    await this.employees.getById(user, employeeId); // 404 + depot check
    return this.repo.listByEmployee(employeeId);
  }

  /** Score one employee for a period WITHOUT writing anything — the preview a manager reads. */
  async score(
    user: AuthenticatedUser,
    employeeId: string,
    periodMonth: string,
  ): Promise<ScoredEmployee> {
    const employee = await this.employees.getById(user, employeeId);
    return this.scoreOne(employee, periodMonth);
  }

  /**
   * Compute and persist. The manager's own words are passed through untouched — a
   * recomputation must never silently rewrite what a human wrote.
   */
  async generate(
    user: AuthenticatedUser,
    employeeId: string,
    periodMonth: string,
    managerNote?: string,
  ): Promise<PerformanceReview> {
    const scored = await this.score(user, employeeId, periodMonth);
    return this.repo.upsert({
      employeeId,
      periodMonth,
      // No measurable component at all still has to store a number; 0 with every component
      // null in `metrics` is readable as "nothing to measure", which a null score is not.
      score: scored.score.final ?? 0,
      attendanceScore: scored.score.attendance,
      disciplineScore: scored.score.discipline,
      salesScore: scored.score.sales,
      metrics: {
        ...scored.inputs,
        effectiveWeights: scored.score.effectiveWeights,
      } as unknown as Prisma.InputJsonValue,
      reviewerId: user.sub,
      note: null,
      ...(managerNote !== undefined ? { managerNote } : {}),
    });
  }

  /** Every employee in scope scored for the period — the /hr/performance dashboard. */
  async dashboard(
    user: AuthenticatedUser,
    periodMonth: string,
    depotId?: string,
  ): Promise<ScoredEmployee[]> {
    const { rows } = await this.employeesRepo.list({
      depotIds: depotScopeIds(user, depotId),
      status: 'ACTIVE',
      skip: 0,
      take: DASHBOARD_LIMIT,
    });
    const scored: ScoredEmployee[] = [];
    for (const employee of rows) scored.push(await this.scoreOne(employee, periodMonth));
    // Highest first; an unmeasurable score sinks to the bottom rather than reading as 0.
    return scored.sort((a, b) => (b.score.final ?? -1) - (a.score.final ?? -1));
  }

  // ── internals ───────────────────────────────────────────────────────

  private async scoreOne(employee: Employee, periodMonth: string): Promise<ScoredEmployee> {
    const [year, month] = periodMonth.split('-').map(Number);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));

    const summary = await this.attendance.summary(employee.id, from, to);
    const holidayDates = this.holidays
      ? await this.holidays.listDates(employee.depotId, from, to)
      : [];
    const workingDays = workingDaysInMonth(
      year,
      month,
      new Set(holidayDates),
      parseWeeklyOffDays(this.config.weeklyOffDays(employee.depotId)),
    );
    // Fail-soft exactly like the bonus rules: an unreachable order-service means the sales
    // component is unmeasurable, never a zero that drags somebody's score down.
    const salesTotal = this.sales
      ? await this.sales.depotSales(employee.depotId, from, to).catch(() => null)
      : null;

    const inputs: ScoreInputs = {
      presentDays: summary.presentDays,
      lateDays: summary.lateDays,
      workingDays,
      salesTotal,
      salesTarget: this.config.performanceSalesTarget(employee.depotId),
    };

    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      depotId: employee.depotId,
      position: employee.position,
      inputs,
      score: computePerformanceScore(inputs, this.config.performanceWeights(employee.depotId)),
    };
  }
}
