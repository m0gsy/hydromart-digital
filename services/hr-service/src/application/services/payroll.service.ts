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
import { parseRaiseLadder, tenureRaisePercent, tenureYears } from '../../domain/tenure';
import {
  evalBonusRule,
  BonusContext,
  BonusMetric,
  CompareOp,
  RewardKind,
} from '../../domain/bonus-rules';
import { loanDeductionFor } from '../../domain/loan';
import { formatMinutes, minuteRate, overtimePay, splitOvertime } from '../../domain/overtime';
import { statutoryDeductions } from '../../domain/statutory';
import { payrollSlipPdf } from '../../domain/payroll-pdf';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { HOLIDAY_REPOSITORY, HolidayRepository } from '../ports/holiday.repository';
import { BONUS_RULE_REPOSITORY, BonusRuleRepository } from '../ports/bonus-rule.repository';
import { LOAN_REPOSITORY, LoanRepository } from '../ports/loan.repository';
import { SALES_PORT, SalesPort } from '../ports/sales.port';
import {
  BONUS_REPOSITORY,
  BonusRepository,
  DEDUCTION_REPOSITORY,
  DeductionRepository,
} from '../ports/adjustment.repository';
import { ALLOWANCE_REPOSITORY, AllowanceRepository } from '../ports/allowance.repository';
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
    @Optional() @Inject(BONUS_RULE_REPOSITORY) private readonly bonusRules?: BonusRuleRepository,
    @Optional() @Inject(LOAN_REPOSITORY) private readonly loans?: LoanRepository,
    @Optional() @Inject(SALES_PORT) private readonly sales?: SalesPort,
    @Optional() @Inject(ALLOWANCE_REPOSITORY) private readonly allowances?: AllowanceRepository,
  ) {}

  /**
   * Generate (or re-generate a DRAFT) monthly payroll for one employee. Idempotent per
   * (employee, period): an APPROVED/PAID payroll is locked and re-generation is refused.
   */
  async generate(
    user: AuthenticatedUser,
    employeeId: string,
    periodMonth: string,
  ): Promise<PayrollWithItems> {
    if (!PERIOD_RE.test(periodMonth)) {
      throw new BadRequestException('periodMonth harus format YYYY-MM');
    }
    const employee = await this.employees.getById(user, employeeId); // 404 + depot check

    const existing = await this.repo.findByEmployeeAndPeriod(employeeId, periodMonth);
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException(
        `Payroll ${periodMonth} sudah ${existing.status}, tidak bisa dibuat ulang`,
      );
    }

    const { from, to } = this.monthRange(periodMonth);
    const { presentDays, lateDays, leaveDays } = await this.attendance.summary(
      employeeId,
      from,
      to,
    );

    const items: PayrollItemInput[] = [];

    // BASE
    const base = this.basePay(employee, presentDays);
    items.push({
      kind: 'BASE',
      label: employee.salaryType === 'DAILY' ? `Gaji pokok (${presentDays} hari)` : 'Gaji pokok',
      amount: base,
    });

    // Tenure raise for depot heads (Rule-E): % uplift on base pay by completed years.
    // Driven by the JABATAN, not the employment status — a depot head on probation is
    // still a depot head, and `DEPOT_MANAGER` is no longer an EmploymentStatus at all.
    if (employee.role === 'KEPALA_DEPOT' && base > 0) {
      const ladder = parseRaiseLadder(this.config.tenureRaiseLadder(employee.depotId));
      const years = tenureYears(employee.joinDate, to);
      const pct = tenureRaisePercent(ladder, years);
      if (pct > 0) {
        items.push({
          kind: 'BASE',
          label: `Kenaikan masa kerja (${years} th, +${pct}%)`,
          amount: Math.round((base * pct) / 100),
        });
      }
    }

    // ALLOWANCE lines — fixed recurring pay (transport, meal…), separate from BONUS on the
    // payslip. Added before bonuses so a reader sees fixed pay first, but deliberately NOT
    // part of `BonusContext.basePay` below: a percent-of-salary rule pays on basic pay only.
    if (this.allowances) {
      const rows = await this.allowances.listActiveForPeriod(employeeId, from, to);
      for (const a of rows) {
        items.push({
          kind: 'ALLOWANCE',
          label: a.note ?? `Tunjangan ${a.type}`,
          amount: Number(a.amount),
          sourceRef: a.id,
        });
      }
    }

    // BONUS lines — manual rows first, then configurable auto-rules.
    const bonusRows = await this.bonuses.listByEmployeePeriod(employeeId, periodMonth);
    for (const b of bonusRows) {
      items.push({
        kind: 'BONUS',
        label: b.note ?? `Bonus ${b.type}`,
        amount: Number(b.amount),
        sourceRef: b.id,
      });
    }

    // Auto-bonus rules (Rule-F): base pay = BASE items so far (incl. tenure raise).
    if (this.bonusRules) {
      const workingDays = await this.workingDays(periodMonth, employee.depotId, from, to);
      const rules = await this.bonusRules.listActiveForDepot(employee.depotId);
      // Only pay the cross-service sales call when a SALES rule actually needs it.
      const needsSales = rules.some((r) => r.metric === 'SALES_TOTAL');
      // No home depot ⇒ no depot sales to attribute. null (not 0) so a SALES rule is
      // SKIPPED rather than evaluated as a miss — see evalBonusRule.
      const salesTotal =
        needsSales && this.sales && employee.depotId
          ? await this.sales.depotSales(employee.depotId, from, to)
          : null;
      const ctx: BonusContext = {
        presentDays,
        workingDays,
        lateDays,
        isDepotManager: employee.role === 'KEPALA_DEPOT',
        salesTotal,
        basePay: sum(items, 'BASE'),
      };
      for (const r of rules) {
        const amount = evalBonusRule(
          {
            metric: r.metric as BonusMetric,
            op: r.op as CompareOp,
            threshold: Number(r.threshold),
            rewardKind: r.rewardKind as RewardKind,
            rewardValue: Number(r.rewardValue),
          },
          ctx,
        );
        if (amount > 0) items.push({ kind: 'BONUS', label: r.name, amount, sourceRef: r.id });
      }
    }

    // Overtime (M24-17). A weekly-off day and a national holiday are the same thing to
    // payroll — neither was an expected working day — so both are paid at the off-day
    // multiplier and every worked minute on them counts, not just the excess.
    const overtime = await this.overtimeBonus(employee, periodMonth, from, to);
    if (overtime) items.push(overtime);

    // DEDUCTION lines: auto late (lateDays × config) + manual rows
    const lateRate = this.config.lateDeductionAmount(employee.depotId);
    if (lateDays > 0 && lateRate > 0) {
      items.push({
        kind: 'DEDUCTION',
        label: `Potongan terlambat (${lateDays} hari)`,
        amount: lateDays * lateRate,
      });
    }
    // Auto-absence: for MONTHLY (fixed-salary) staff, deduct for expected-but-absent working
    // days. DAILY staff already earn nothing for a missing day, so no extra deduction there.
    if (employee.salaryType === 'MONTHLY') {
      const absentDays = await this.absentDays(
        periodMonth,
        employee.depotId,
        from,
        to,
        presentDays,
        leaveDays,
      );
      const absenceRate = this.config.absenceDeductionAmount(employee.depotId);
      if (absentDays > 0 && absenceRate > 0) {
        items.push({
          kind: 'DEDUCTION',
          label: `Potongan absen (${absentDays} hari)`,
          amount: absentDays * absenceRate,
        });
      }
    }

    const deductionRows = await this.deductions.listByEmployeePeriod(employeeId, periodMonth);
    for (const d of deductionRows) {
      items.push({
        kind: 'DEDUCTION',
        label: d.note ?? `Potongan ${d.type}`,
        amount: Number(d.amount),
        sourceRef: d.id,
      });
    }

    // Auto loan/kasbon installment (Rule-G): pure per-period deduction, idempotent on re-generate.
    if (this.loans) {
      const activeLoans = await this.loans.listActiveByEmployee(employeeId);
      for (const loan of activeLoans) {
        const amount = loanDeductionFor(
          {
            principal: Number(loan.principal),
            installmentAmount: Number(loan.installmentAmount),
            startPeriod: loan.startPeriod,
          },
          periodMonth,
        );
        if (amount > 0) {
          items.push({
            kind: 'DEDUCTION',
            label: loan.note ? `Cicilan: ${loan.note}` : 'Cicilan pinjaman',
            amount,
            sourceRef: loan.id,
          });
        }
      }
    }

    // Allowances are fixed pay, so they belong in gross next to BASE rather than in the
    // variable bonus total. The payslip still separates them: every item carries its kind.
    const gross = sum(items, 'BASE') + sum(items, 'ALLOWANCE');

    // Statutory deductions (Q-13): BPJS employee shares, then PPh 21 on what is left.
    // Added LAST, and computed on `gross` (base + allowances) rather than on the running
    // total, because that is the regulated base — a lateness deduction does not reduce
    // the wage BPJS is reckoned on, and a bonus is taxed through the annual filing rather
    // than this month's estimate. Every rate is configuration; see domain/statutory.ts
    // for what is and is not modelled, including the December reconciliation gap.
    for (const line of statutoryDeductions(
      {
        grossIdr: gross,
        ptkpStatus: employee.ptkpStatus,
        // No NPWP on file is the surcharge case, and a blank string is no NPWP.
        hasNpwp: !!employee.npwp?.trim(),
        // A BPJS number on file IS the enrolment record — see domain/statutory.ts for
        // why an unenrolled employee must not be deducted for.
        enrolledHealth: !!employee.bpjsKes?.trim(),
        enrolledEmployment: !!employee.bpjsTk?.trim(),
      },
      this.config.statutoryRates(employee.depotId),
    )) {
      items.push({ kind: 'DEDUCTION', label: line.label, amount: line.amountIdr });
    }

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
      throw new ConflictException(
        `Hanya payroll DRAFT yang bisa disetujui (saat ini ${payroll.status})`,
      );
    }
    return this.repo.setStatus(id, payroll.status, 'APPROVED', {
      approvedBy: user.sub,
      approvedAt: new Date(),
    });
  }

  async markPaid(user: AuthenticatedUser, id: string): Promise<PayrollWithItems> {
    const payroll = await this.load(user, id);
    if (payroll.status !== 'APPROVED') {
      throw new ConflictException(
        `Hanya payroll APPROVED yang bisa dibayar (saat ini ${payroll.status})`,
      );
    }
    return this.repo.setStatus(id, payroll.status, 'PAID', { paidAt: new Date() });
  }

  async getById(user: AuthenticatedUser, id: string): Promise<PayrollWithItems> {
    return this.load(user, id);
  }

  /** Render a salary-slip PDF for one payroll. */
  async slip(user: AuthenticatedUser, id: string): Promise<Buffer> {
    const payroll = await this.load(user, id); // 404 + depot check
    const employee = await this.employees.getById(user, payroll.employeeId);
    return payrollSlipPdf({
      employeeName: employee.fullName,
      employeeCode: employee.employeeCode,
      periodMonth: payroll.periodMonth,
      status: payroll.status,
      lines: payroll.items.map((i) => ({
        label: i.label,
        amount: Math.abs(Number(i.amount)),
        deduction: i.kind === 'DEDUCTION',
      })),
      net: Number(payroll.net),
    });
  }

  list(query: {
    periodMonth?: string;
    employeeId?: string;
    status?: Payroll['status'];
    page: number;
    pageSize: number;
  }) {
    return this.repo.list({
      periodMonth: query.periodMonth,
      employeeId: query.employeeId,
      status: query.status,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  /** The caller's OWN payroll history (self-service PWA). Scoped by the linked employee. */
  async listSelf(
    user: AuthenticatedUser,
    query: { periodMonth?: string; page: number; pageSize: number },
  ) {
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
    depotId: string | null,
    from: Date,
    to: Date,
    presentDays: number,
    leaveDays: number,
  ): Promise<number> {
    const workingDays = await this.workingDays(periodMonth, depotId, from, to);
    return Math.max(0, workingDays - presentDays - leaveDays);
  }

  /**
   * M24-17 overtime as a single BONUS line. Returns null when nothing is owed, so a
   * period with no overtime keeps the slip exactly as it was.
   */
  private async overtimeBonus(
    employee: Employee,
    periodMonth: string,
    from: Date,
    to: Date,
  ): Promise<PayrollItemInput | null> {
    const depotId = employee.depotId;
    const standardWorkingMinutes = this.config.standardWorkingMinutes(depotId);
    const days = await this.attendance.listWorkedMinutes(employee.id, from, to);
    if (days.length === 0) return null;

    // The off-day test is the union of the weekly-off weekdays and the dated national
    // holidays — the two are deliberately indistinguishable here (M24-17).
    const weeklyOff = parseWeeklyOffDays(this.config.weeklyOffDays(depotId));
    const holidayDates = new Set(
      this.holidays ? await this.holidays.listDates(depotId, from, to) : [],
    );
    const isOffDay = (workDate: string): boolean =>
      holidayDates.has(workDate) ||
      weeklyOff.has(new Date(`${workDate}T00:00:00.000Z`).getUTCDay());

    const breakdown = splitOvertime(
      days.map((d) => ({
        workDate: d.workDate.toISOString().slice(0, 10),
        workingMinutes: d.workingMinutes,
      })),
      standardWorkingMinutes,
      isOffDay,
    );
    if (breakdown.totalMinutes === 0) return null;

    const perMinute = minuteRate(
      employee.salaryType === 'DAILY' ? 'DAILY' : 'MONTHLY',
      employee.monthlyRate != null ? Number(employee.monthlyRate) : 0,
      employee.dailyRate != null
        ? Number(employee.dailyRate)
        : employee.employmentStatus === 'TRAINING'
          ? this.config.dailyRateTraining(depotId)
          : 0,
      await this.workingDays(periodMonth, depotId, from, to),
      standardWorkingMinutes,
    );
    const amount = overtimePay(breakdown, perMinute, {
      multiplier: this.config.overtimeMultiplierPct(depotId) / 100,
      offDayMultiplier: this.config.overtimeOffDayMultiplierPct(depotId) / 100,
    });
    if (amount <= 0) return null;

    const parts = [
      breakdown.regularMinutes > 0 ? `hari kerja ${formatMinutes(breakdown.regularMinutes)}` : null,
      breakdown.offDayMinutes > 0 ? `hari libur ${formatMinutes(breakdown.offDayMinutes)}` : null,
    ].filter(Boolean);
    return { kind: 'BONUS', label: `Lembur (${parts.join(', ')})`, amount };
  }

  /** Expected working days in the period: calendar days − weekly-off − holidays. */
  private async workingDays(
    periodMonth: string,
    depotId: string | null,
    from: Date,
    to: Date,
  ): Promise<number> {
    const [year, month] = periodMonth.split('-').map(Number);
    const holidayDates = this.holidays ? await this.holidays.listDates(depotId, from, to) : [];
    return workingDaysInMonth(
      year,
      month,
      new Set(holidayDates),
      parseWeeklyOffDays(this.config.weeklyOffDays(depotId)),
    );
  }

  private basePay(employee: Employee, presentDays: number): number {
    if (employee.salaryType === 'DAILY') {
      const rate =
        employee.dailyRate != null
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
