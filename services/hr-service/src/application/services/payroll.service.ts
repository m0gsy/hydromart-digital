import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, Payroll } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { parseWeeklyOffDays, workingDaysInMonth } from '../../domain/calendar';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { HOLIDAY_REPOSITORY, HolidayRepository } from '../ports/holiday.repository';
import {
  BONUS_REPOSITORY,
  BonusRepository,
  DEDUCTION_REPOSITORY,
  DeductionRepository,
} from '../ports/adjustment.repository';
import {
  PAYROLL_REPOSITORY,
  PayrollItemInput,
  PayrollRepository,
  PayrollWithItems,
} from '../ports/payroll.repository';
import { EmployeeService } from './employee.service';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class PayrollService {
  constructor(
    @Inject(PAYROLL_REPOSITORY) private readonly repo: PayrollRepository,
    @Inject(ATTENDANCE_REPOSITORY) private readonly attendance: AttendanceRepository,
    @Inject(BONUS_REPOSITORY) private readonly bonuses: BonusRepository,
    @Inject(DEDUCTION_REPOSITORY) private readonly deductions: DeductionRepository,
    private readonly employees: EmployeeService,
    private readonly config: HrConfigService,
    @Optional() @Inject(HOLIDAY_REPOSITORY) private readonly holidays?: HolidayRepository,
  ) {}

  /**
   * Generate (or re-generate a DRAFT) monthly payroll for one employee. Idempotent per
   * (employee, period): an APPROVED/PAID payroll is locked and re-generation is refused.
   */
  async generate(user: AuthenticatedUser, employeeId: string, periodMonth: string): Promise<PayrollWithItems> {
    if (!PERIOD_RE.test(periodMonth)) {
      throw new BadRequestException('periodMonth harus format YYYY-MM');
    }
    const employee = await this.employees.getById(user, employeeId); // 404 + depot check

    const existing = await this.repo.findByEmployeeAndPeriod(employeeId, periodMonth);
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException(`Payroll ${periodMonth} sudah ${existing.status}, tidak bisa dibuat ulang`);
    }

    const { from, to } = this.monthRange(periodMonth);
    const { presentDays, lateDays, leaveDays } = await this.attendance.summary(employeeId, from, to);

    const items: PayrollItemInput[] = [];

    // BASE
    const base = this.basePay(employee, presentDays);
    items.push({
      kind: 'BASE',
      label: employee.salaryType === 'DAILY' ? `Gaji pokok (${presentDays} hari)` : 'Gaji pokok',
      amount: base,
    });

    // BONUS lines
    const bonusRows = await this.bonuses.listByEmployeePeriod(employeeId, periodMonth);
    for (const b of bonusRows) {
      items.push({ kind: 'BONUS', label: b.note ?? `Bonus ${b.type}`, amount: Number(b.amount), sourceRef: b.id });
    }

    // DEDUCTION lines: auto late (lateDays × config) + manual rows
    const lateRate = this.config.lateDeductionAmount(employee.depotId);
    if (lateDays > 0 && lateRate > 0) {
      items.push({ kind: 'DEDUCTION', label: `Potongan terlambat (${lateDays} hari)`, amount: lateDays * lateRate });
    }
    // Auto-absence: for MONTHLY (fixed-salary) staff, deduct for expected-but-absent working
    // days. DAILY staff already earn nothing for a missing day, so no extra deduction there.
    if (employee.salaryType === 'MONTHLY') {
      const absentDays = await this.absentDays(periodMonth, employee.depotId, from, to, presentDays, leaveDays);
      const absenceRate = this.config.absenceDeductionAmount(employee.depotId);
      if (absentDays > 0 && absenceRate > 0) {
        items.push({ kind: 'DEDUCTION', label: `Potongan absen (${absentDays} hari)`, amount: absentDays * absenceRate });
      }
    }

    const deductionRows = await this.deductions.listByEmployeePeriod(employeeId, periodMonth);
    for (const d of deductionRows) {
      items.push({ kind: 'DEDUCTION', label: d.note ?? `Potongan ${d.type}`, amount: Number(d.amount), sourceRef: d.id });
    }

    const gross = sum(items, 'BASE');
    const totalBonus = sum(items, 'BONUS');
    const totalDeduction = sum(items, 'DEDUCTION');
    const write = {
      employeeId,
      periodMonth,
      gross,
      totalBonus,
      totalDeduction,
      net: gross + totalBonus - totalDeduction,
      presentDays,
      createdBy: user.sub,
      items,
    };
    return existing ? this.repo.regenerate(existing.id, write) : this.repo.create(write);
  }

  async approve(user: AuthenticatedUser, id: string): Promise<PayrollWithItems> {
    const payroll = await this.load(user, id);
    if (payroll.status !== 'DRAFT') {
      throw new ConflictException(`Hanya payroll DRAFT yang bisa disetujui (saat ini ${payroll.status})`);
    }
    return this.repo.setStatus(id, 'APPROVED', { approvedBy: user.sub, approvedAt: new Date() });
  }

  async markPaid(user: AuthenticatedUser, id: string): Promise<PayrollWithItems> {
    const payroll = await this.load(user, id);
    if (payroll.status !== 'APPROVED') {
      throw new ConflictException(`Hanya payroll APPROVED yang bisa dibayar (saat ini ${payroll.status})`);
    }
    return this.repo.setStatus(id, 'PAID', { paidAt: new Date() });
  }

  async getById(user: AuthenticatedUser, id: string): Promise<PayrollWithItems> {
    return this.load(user, id);
  }

  list(query: { periodMonth?: string; employeeId?: string; status?: Payroll['status']; page: number; pageSize: number }) {
    return this.repo.list({
      periodMonth: query.periodMonth,
      employeeId: query.employeeId,
      status: query.status,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  /** The caller's OWN payroll history (self-service PWA). Scoped by the linked employee. */
  async listSelf(user: AuthenticatedUser, query: { periodMonth?: string; page: number; pageSize: number }) {
    const employee = await this.employees.getSelf(user);
    return this.repo.list({
      employeeId: employee.id,
      periodMonth: query.periodMonth,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  private async load(user: AuthenticatedUser, id: string): Promise<PayrollWithItems> {
    const payroll = await this.repo.findById(id);
    if (!payroll) throw new NotFoundException('Payroll tidak ditemukan');
    await this.employees.getById(user, payroll.employeeId); // depot check on the owning employee
    return payroll;
  }

  /** Expected working days (calendar − weekly-off − holidays) minus days present or on leave. */
  private async absentDays(
    periodMonth: string,
    depotId: string,
    from: Date,
    to: Date,
    presentDays: number,
    leaveDays: number,
  ): Promise<number> {
    const [year, month] = periodMonth.split('-').map(Number);
    const holidayDates = this.holidays ? await this.holidays.listDates(depotId, from, to) : [];
    const workingDays = workingDaysInMonth(
      year,
      month,
      new Set(holidayDates),
      parseWeeklyOffDays(this.config.weeklyOffDays(depotId)),
    );
    return Math.max(0, workingDays - presentDays - leaveDays);
  }

  private basePay(employee: Employee, presentDays: number): number {
    if (employee.salaryType === 'DAILY') {
      const rate = employee.dailyRate != null
        ? Number(employee.dailyRate)
        : employee.employmentStatus === 'TRAINING'
          ? this.config.dailyRateTraining(employee.depotId)
          : 0;
      return Math.round(rate * presentDays);
    }
    return employee.monthlyRate != null ? Math.round(Number(employee.monthlyRate)) : 0;
  }

  /** [first-day, last-day] of a YYYY-MM as UTC-midnight dates (matches @db.Date storage). */
  private monthRange(periodMonth: string): { from: Date; to: Date } {
    const [y, m] = periodMonth.split('-').map(Number);
    return {
      from: new Date(Date.UTC(y, m - 1, 1)),
      to: new Date(Date.UTC(y, m, 0)),
    };
  }
}

function sum(items: PayrollItemInput[], kind: PayrollItemInput['kind']): number {
  return items.filter((i) => i.kind === kind).reduce((t, i) => t + i.amount, 0);
}
