import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuthenticatedUser, depotScopeIds, localMonthKey } from '@hydromart/platform';

import { Employee, Payroll } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { parseWeeklyOffDays, workingDaysInMonth, workingDaysInRange } from '../../domain/calendar';
import {
  parseRaiseLadder,
  tenureMonths,
  tenureRaisePercent,
  tenureYears,
  thrAmount,
} from '../../domain/tenure';
import {
  evalBonusRule,
  BonusContext,
  BonusMetric,
  CompareOp,
  RewardKind,
} from '../../domain/bonus-rules';
import { loanDeductionFor } from '../../domain/loan';
import { rupiah } from '../../domain/rupiah';
import { DayRule, formatMinutes, minuteRate, overtimePay, splitOvertime } from '../../domain/overtime';
import {
  assignmentInForce,
  parseRotationPattern,
  shiftSpanMinutes,
} from '../../domain/shift-rotation';
import {
  Pph21YearToDate,
  StatutoryInput,
  StatutoryRates,
  bpjsEmployeeDeductions,
  pph21December,
  pph21Monthly,
} from '../../domain/statutory';
import { payrollSlipPdf } from '../../domain/payroll-pdf';
import { bonusForDay, parseTiers } from '../../domain/daily-sales-bonus';
import { parseFines, tierOf } from '../../domain/late-fine';
import {
  ATTENDANCE_REPOSITORY,
  AttendanceRepository,
  WorkedMinutesRow,
} from '../ports/attendance.repository';
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
import { SHIFT_REPOSITORY, ShiftRepository } from '../ports/shift.repository';
import {
  PAYROLL_REPOSITORY,
  PayrollItemInput,
  PayrollRepository,
  PayrollWithEmployee,
  PayrollWithItems,
} from '../ports/payroll.repository';
import { EmployeeService } from './employee.service';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** getUTCDay: 0 = Sunday. Friday is the one weekday with its own break length (D2). */
const FRIDAY = 5;

/**
 * The rota HR built, reduced to the two numbers payroll reckons with.
 *
 * Resolved once per employee per period, from the assignment in force on the FIRST day of
 * the month: a rota that changes mid-month is rare, and reading the shift tables once per
 * employee instead of once per attended day keeps generation the number of queries it was.
 */
interface Rota {
  /** Weekdays this employee does not work: their rotation's blank days, else the depot's. */
  offWeekdays: ReadonlySet<number>;
  /** How a day that fell on this weekday is reckoned — its shift, net of that day's break. */
  ruleFor(weekday: number, offDay: boolean): DayRule;
  /** One number for the whole period: the divisor behind the overtime minute rate. */
  standardMinutes: number;
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

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
    @Optional() @Inject(SHIFT_REPOSITORY) private readonly shifts?: ShiftRepository,
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
    this.assertPeriodClosed(periodMonth);
    const employee = await this.employees.getById(user, employeeId); // 404 + depot check

    const existing = await this.repo.findByEmployeeAndPeriod(employeeId, periodMonth);
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException(
        `Payroll ${periodMonth} sudah ${existing.status}, tidak bisa dibuat ulang`,
      );
    }

    // D3b — a RESIGNED employee is off the payroll, but only a DATE can say how much of the
    // period they earned, and `employmentWindow` reads nothing but `joinDate`/`exitDate`. A
    // resignation recorded without a date used to pay the full month, every month, forever.
    // User decision 2026-08-14: the status stops the wage — by REFUSING, not by guessing an
    // exit day. Inventing one is the same leak wearing a date. The status alone stays valid
    // on the employee record (it switches the login off); it is payroll that needs the date.
    if (employee.status === 'RESIGNED' && !employee.exitDate) {
      throw new BadRequestException(
        'Karyawan berstatus RESIGNED tanpa tanggal keluar. Isi tanggal keluar (exitDate) ' +
          `dulu sebelum membuat payroll ${periodMonth}.`,
      );
    }

    const { from, to } = this.monthRange(periodMonth);
    // Depot SOP daily gallon bonus. Parsed BEFORE the reads so the cross-service gallon
    // call is only paid for when a ladder is actually configured — an empty ladder (every
    // depot until someone fills it in) must cost nothing and change nothing.
    const gallonTiers = parseTiers(this.config.dailySalesBonusTiers(employee.depotId));
    const wantsDailyBonus = gallonTiers.length > 0 && !!this.sales && !!employee.depotId;

    // Reads that need nothing from each other — attendance, allowances, manual bonuses, the
    // depot's working days, its bonus rules, the per-day attendance rows and the depot's
    // daily gallons — used to be awaited one after another (audit S-21). Payroll generation
    // runs per employee, so this is the run's whole cost multiplied by headcount.
    const [
      { presentDays, lateDays, leaveDays, pendingDays },
      allowanceRows,
      bonusRows,
      rota,
      rules,
      workedDays,
      dailyGallons,
    ] = await Promise.all([
      this.attendance.summary(employeeId, from, to),
      this.allowances ? this.allowances.listActiveForPeriod(employeeId, from, to) : [],
      this.bonuses.listByEmployeePeriod(employeeId, periodMonth),
      this.rotaFor(employee, from),
      this.bonusRules ? this.bonusRules.listActiveForDepot(employee.depotId) : [],
      this.attendance.listWorkedMinutes(employeeId, from, to),
      wantsDailyBonus
        ? // Day KEYS, not Dates: `workDate` is a LOCAL date kept as UTC-midnight and
          // order-service buckets in the same PRICING_TZ. `monthRange` is already
          // UTC-midnight, so slicing the ISO string is the local day.
          this.sales!.depotDailyGallons(employee.depotId!, dayKey(from), dayKey(to))
        : null,
    ]);

    // CA-1-38 — the expected working days are the ones the ROTA expects, so both of these
    // now take the rota's off-weekdays rather than reading the depot CSV a second time.
    const workingDays = this.bonusRules
      ? await this.workingDays(periodMonth, employee.depotId, from, to, rota.offWeekdays)
      : 0;

    // D3 — the slice of the period this person was actually on the payroll for.
    const window = await this.employmentWindow(employee, periodMonth, from, to, rota.offWeekdays);
    if (window.employedDays === 0 && window.periodDays > 0) {
      throw new BadRequestException(
        `Karyawan tidak bekerja pada periode ${periodMonth} (masuk ${dayKey(employee.joinDate)}` +
          `${employee.exitDate ? `, keluar ${dayKey(employee.exitDate)}` : ''})`,
      );
    }

    const items: PayrollItemInput[] = [];

    // BASE
    const base = this.basePay(employee, presentDays, window.fraction);
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
      for (const a of allowanceRows) {
        // D6 — the same window as BASE. A monthly transport allowance paid in full to
        // somebody employed for three days is the identical leak wearing a different label,
        // and it survived the D3 fix on its own until this line changed too.
        items.push({
          kind: 'ALLOWANCE',
          label: a.note ?? `Tunjangan ${a.type}`,
          amount: Math.round(rupiah(a.amount) * window.fraction),
          sourceRef: a.id,
        });
      }
    }

    // CA-1-45 — THR, PP 36/2021 pasal 9: 12 bulan ke atas = 1 bulan upah, 1–12 bulan =
    // prorata masa kerja / 12, di bawah 1 bulan = tidak dapat.
    //
    // Paid off the CONTRACTED wage, never off `base`: `base` is already prorated by this
    // month's employment window and, for DAILY staff, by the days they actually turned up
    // — PP 36/2021 pays a month of pay, not a share of the month worked. A DAILY employee's
    // "one month's wage" is their daily rate over the month's working days, which is the
    // same `periodDays` the window already counted (calendar days − rota off days −
    // holidays), so the two definitions of "a month" on this payslip cannot drift apart.
    //
    // BONUS, like every other bonus here: it stays out of `gross` and therefore out of the
    // BPJS and PPh21 monthly estimate, which is the repo-wide treatment documented below.
    if (periodMonth === this.config.thrPeriodMonth(employee.depotId)) {
      // One call covers both: `basePay` reads `presentDays` for DAILY and ignores it for
      // MONTHLY, and the default fraction of 1 is what "undiminished by the window" means.
      const monthWage = this.basePay(employee, window.periodDays);
      const months = tenureMonths(employee.joinDate, to);
      const thr = thrAmount(monthWage, months);
      if (thr > 0) {
        items.push({ kind: 'BONUS', label: `THR (masa kerja ${months} bulan)`, amount: thr });
      }
    }

    // BONUS lines — manual rows first, then configurable auto-rules.
    for (const b of bonusRows) {
      items.push({
        kind: 'BONUS',
        label: b.note ?? `Bonus ${b.type}`,
        amount: rupiah(b.amount),
        sourceRef: b.id,
      });
    }

    // Auto-bonus rules (Rule-F): base pay = BASE items so far (incl. tenure raise).
    if (this.bonusRules) {
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

    // Depot SOP: daily gallon-target bonus, paid IN FULL to each attending staff member for
    // every day the depot hit a tier. `dailyGallons` null (order-service down, or no ladder)
    // pays nothing — same rule as the SALES_TOTAL bonus, never a fabricated zero-day.
    if (dailyGallons) {
      let total = 0;
      let days = 0;
      for (const row of workedDays) {
        const amount = bonusForDay(gallonTiers, dailyGallons.get(dayKey(row.workDate)) ?? 0);
        if (amount > 0) {
          total += amount;
          days++;
        }
      }
      if (total > 0) {
        items.push({ kind: 'BONUS', label: `Bonus target harian (${days} hari)`, amount: total });
      }
    }

    // Overtime (M24-17). A weekly-off day and a national holiday are the same thing to
    // payroll — neither was an expected working day — so both are paid at the off-day
    // multiplier and every worked minute on them counts, not just the excess.
    const overtime = await this.overtimeBonus(employee, periodMonth, from, to, workedDays, rota);
    if (overtime) items.push(overtime);

    // DEDUCTION lines: lateness + absence, then manual rows.
    //
    // Days nobody showed up for, measured against the days they were EMPLOYED — never the
    // whole month. Computed once here because BOTH fine branches below need it and they used
    // to answer it differently: the flat branch was fixed for the D3 knock-on (a 25th-of-the
    // month joiner fined for the first 24 days) while the tiered branch still counted the
    // month, so the same joiner was charged Rp 400.000 the moment a depot configured
    // `lateFineCsv`. One expression, two consumers, no way for them to drift again.
    //
    // D2: absence is derived by SUBTRACTION, so a status left out of the subtrahend becomes a
    // no-show and is fined. PENDING is a day somebody DID punch for — offline and synced too
    // late to trust the clock, or outside every geofence — and it counts as nothing until HR
    // judges it. Fining it charged an honest employee for HR's backlog.
    const autoAbsentDays = Math.max(
      0,
      window.employedDays - presentDays - leaveDays - pendingDays,
    );
    const isDepotManager = employee.role === 'KEPALA_DEPOT';
    const fines = parseFines(this.config.lateFineCsv(isDepotManager, employee.depotId));
    if (fines) {
      // Depot SOP §2: three steps by minutes late, at the rate for this jabatan.
      //
      // D8, answered by HR 2026-08-13: a day past `absentAfterMinutes` is fined as "tidak
      // absen" and the wage is still paid IN FULL, and it still counts toward the daily
      // gallon-target bonus. They were here and they worked; the lateness is what is punished,
      // not the day's earnings. Deliberate — do not "fix" it into a lost day or a lost bonus.
      const counts = { T1: 0, T2: 0, ABSENT: 0 };
      const tier2After = this.config.lateTier2AfterMinutes(employee.depotId);
      const absentAfter = this.config.absentAfterMinutes(employee.depotId);
      for (const row of workedDays) {
        const tier = tierOf(row.lateMinutes, tier2After, absentAfter);
        if (tier !== 'NONE') counts[tier]++;
      }
      // A day nobody showed up for and a day someone showed up hours late are the same
      // thing to the SOP — one "tidak absen" fine each. They cannot overlap: an ABSENT-by-
      // lateness day HAS an attendance row, so it is not counted in `autoAbsentDays`.
      //
      // Deliberately NOT gated on MONTHLY the way the flat branch below is: under the flat
      // rule daily-rate depot staff escaped the missed-day fine entirely, and the SOP fine is
      // a sanction rather than a wage adjustment. Pinned by "fines a DAILY employee for
      // calendar days nobody turned up for" in payroll.service.spec.ts.
      counts.ABSENT += autoAbsentDays;
      const lines: [keyof typeof counts, number, string][] = [
        ['T1', fines.tier1, 'Denda telat 1'],
        ['T2', fines.tier2, 'Denda telat 2'],
        ['ABSENT', fines.absent, 'Denda tidak absen'],
      ];
      for (const [key, rate, label] of lines) {
        const days = counts[key];
        if (days > 0 && rate > 0) {
          items.push({ kind: 'DEDUCTION', label: `${label} (${days} hari)`, amount: days * rate });
        }
      }
    } else {
      // No tiered fine configured: the flat rate, exactly as before.
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
        const absenceRate = this.config.absenceDeductionAmount(employee.depotId);
        if (autoAbsentDays > 0 && absenceRate > 0) {
          items.push({
            kind: 'DEDUCTION',
            label: `Potongan absen (${autoAbsentDays} hari)`,
            amount: autoAbsentDays * absenceRate,
          });
        }
      }
    }

    const deductionRows = await this.deductions.listByEmployeePeriod(employeeId, periodMonth);
    for (const d of deductionRows) {
      items.push({
        kind: 'DEDUCTION',
        label: d.note ?? `Potongan ${d.type}`,
        amount: rupiah(d.amount),
        sourceRef: d.id,
      });
    }

    // Auto loan/kasbon installment (Rule-G): pure per-period deduction, idempotent on
    // re-generate. Kept in `loanLines` because these are the only deferrable deductions —
    // when the month cannot pay for everything, they are what gives way (D4).
    const loanLines: PayrollItemInput[] = [];
    if (this.loans) {
      const activeLoans = await this.loans.listActiveByEmployee(employeeId);
      // What earlier payslips really took, so a period that could only pay part of an
      // installment leaves the rest owed instead of forgiven.
      const repaid = await this.repo.deductedBySourceRefBefore(
        employeeId,
        periodMonth,
        activeLoans.map((l) => l.id),
      );
      for (const loan of activeLoans) {
        const amount = loanDeductionFor(
          {
            principal: Number(loan.principal),
            installmentAmount: Number(loan.installmentAmount),
            startPeriod: loan.startPeriod,
          },
          periodMonth,
          repaid.get(loan.id) ?? 0,
        );
        if (amount > 0) {
          const line: PayrollItemInput = {
            kind: 'DEDUCTION',
            label: loan.note ? `Cicilan: ${loan.note}` : 'Cicilan pinjaman',
            amount,
            sourceRef: loan.id,
          };
          items.push(line);
          loanLines.push(line);
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
    const statutoryInput = {
      grossIdr: gross,
      ptkpStatus: employee.ptkpStatus,
      // No NPWP on file is the surcharge case, and a blank string is no NPWP.
      hasNpwp: !!employee.npwp?.trim(),
      // A BPJS number on file IS the enrolment record — see domain/statutory.ts for
      // why an unenrolled employee must not be deducted for.
      enrolledHealth: !!employee.bpjsKes?.trim(),
      enrolledEmployment: !!employee.bpjsTk?.trim(),
    };
    const rates = this.config.statutoryRates(employee.depotId);
    const bpjsLines = bpjsEmployeeDeductions(statutoryInput, rates);
    for (const line of bpjsLines) {
      items.push({ kind: 'DEDUCTION', label: line.label, amount: line.amountIdr });
    }
    const bpjsTotal = bpjsLines.reduce((sum, line) => sum + line.amountIdr, 0);

    // December is the month that makes the other eleven honest: the year's actual
    // liability, minus everything already withheld. Every other month is an estimate
    // against a year that has not happened yet.
    const tax = periodMonth.endsWith('-12')
      ? await this.decemberPph21(employee, statutoryInput, bpjsTotal, rates, periodMonth)
      : pph21Monthly(
          statutoryInput,
          bpjsTotal,
          rates,
          this.config.pph21TerTable(employee.depotId),
        ).monthlyIdr;
    if (tax > 0) items.push({ kind: 'DEDUCTION', label: 'PPh 21', amount: tax });

    const totalBonus = sum(items, 'BONUS');
    // D4: nobody may be handed a bill by their employer. Loan installments give way first
    // and keep being owed (the ledger above is what makes that real); anything still over —
    // fines, statutory withholding — stays printed at full value and the net is floored, so
    // the slip shows what was assessed and the payment shows what could be taken.
    const netBeforeFloor = deferLoanInstallments(
      items,
      loanLines,
      gross + totalBonus - sum(items, 'DEDUCTION'),
    );
    const totalDeduction = sum(items, 'DEDUCTION');
    const write = {
      employeeId,
      periodMonth,
      gross,
      totalBonus,
      totalDeduction,
      net: Math.max(0, netBeforeFloor),
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

  async getById(user: AuthenticatedUser, id: string): Promise<PayrollWithEmployee> {
    const payroll = await this.load(user, id);
    // PG-01: `load` already reads the owning employee for the depot check and used to throw
    // the answer away, leaving a slip that named nobody.
    const employee = await this.employees.getById(user, payroll.employeeId);
    return { ...payroll, employeeName: employee.fullName ?? null };
  }

  /**
   * The caller's OWN payroll, by id.
   *
   * `getById` above is `hrView`-gated, which no ordinary employee has — so an employee
   * could list their payslips and then not open one. This is the read that lets them,
   * and it is scoped by ownership rather than by depot.
   *
   * A payroll belonging to somebody else 404s, not 403: a colleague's payroll id is not
   * something an employee should be able to confirm the existence of.
   */
  async getSelfById(user: AuthenticatedUser, id: string): Promise<PayrollWithItems> {
    return (await this.loadSelf(user, id)).payroll;
  }

  /** The same slip PDF as `slip`, for the employee's own payroll only. */
  async selfSlip(user: AuthenticatedUser, id: string): Promise<Buffer> {
    const { payroll, employee } = await this.loadSelf(user, id);
    return PayrollService.renderSlip(payroll, employee);
  }

  private async loadSelf(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ payroll: PayrollWithItems; employee: Employee }> {
    const employee = await this.employees.getSelf(user);
    const payroll = await this.repo.findById(id);
    if (!payroll || payroll.employeeId !== employee.id) {
      throw new NotFoundException('Payroll tidak ditemukan');
    }
    return { payroll, employee };
  }

  /** Render a salary-slip PDF for one payroll. */
  async slip(user: AuthenticatedUser, id: string): Promise<Buffer> {
    const payroll = await this.load(user, id); // 404 + depot check
    const employee = await this.employees.getById(user, payroll.employeeId);
    return PayrollService.renderSlip(payroll, employee);
  }

  /** One slip layout, shared by the staff route and the employee's own. */
  private static renderSlip(payroll: PayrollWithItems, employee: Employee): Promise<Buffer> {
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

  /**
   * D1: depot-scoped payroll list. `hrView` reaches MANAGER, SUPERVISOR and
   * ASSISTANT_SUPERVISOR, so without a scope one page of a period handed a depot manager
   * every employee's gross, bonus, deduction and net in the whole chain. Scoped the same
   * way as `attendance.list` — `GET :id` was already scoped, only the list was open.
   */
  // `async` on purpose: `depotScopeIds` throws for a depot outside the caller's set, and a
  // method typed as returning a promise must reject rather than throw past its own signature.
  async list(
    user: AuthenticatedUser,
    query: {
      periodMonth?: string;
      employeeId?: string;
      status?: Payroll['status'];
      depotId?: string;
      page: number;
      pageSize: number;
    },
  ) {
    return this.repo.list({
      periodMonth: query.periodMonth,
      employeeId: query.employeeId,
      status: query.status,
      depotIds: depotScopeIds(user, query.depotId),
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


  /**
   * M24-17 overtime as a single BONUS line. Returns null when nothing is owed, so a
   * period with no overtime keeps the slip exactly as it was.
   */
  private async overtimeBonus(
    employee: Employee,
    periodMonth: string,
    from: Date,
    to: Date,
    days: WorkedMinutesRow[],
    rota: Rota,
  ): Promise<PayrollItemInput | null> {
    const depotId = employee.depotId;
    if (days.length === 0) return null;

    // The off-day test is the union of the weekly-off weekdays and the dated national
    // holidays — the two are deliberately indistinguishable here (M24-17). The weekly-off
    // half now comes from THIS employee's rota (CA-1-38): a depot-wide CSV paid an off-day
    // multiplier to somebody whose rotation had them rostered that day, and paid a plain
    // rate to somebody working through the rest day their own rotation gave them.
    const holidayDates = new Set(
      this.holidays ? await this.holidays.listDates(depotId, from, to) : [],
    );
    const ruleFor = (workDate: string): DayRule => {
      const weekday = new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
      return rota.ruleFor(weekday, holidayDates.has(workDate) || rota.offWeekdays.has(weekday));
    };

    const breakdown = splitOvertime(
      days.map((d) => ({
        // tz-ok: workDate is @db.Date — the attendance day, already local.
        workDate: d.workDate.toISOString().slice(0, 10),
        workingMinutes: d.workingMinutes,
      })),
      ruleFor,
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
      await this.workingDays(periodMonth, depotId, from, to, rota.offWeekdays),
      rota.standardMinutes,
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

  /**
   * D3/D6 — how much of the period this person was actually employed for, as a count of
   * working days and as the fraction of the period they represent.
   *
   * `joinDate` and `exitDate` are `@db.Date`, stored as UTC midnight, and `monthRange`
   * produces UTC midnights too, so the whole comparison stays on day keys and never meets
   * a timezone. `workingDaysInRange` yields nothing for an inverted range, which is exactly
   * the "employed for none of this period" case.
   *
   * `contractEndDate` is deliberately NOT a boundary here. The schema calls it "a reminder
   * for HR, not a status change", and it is null for every open-ended employee — clamping
   * pay to it would silently stop paying someone whose renewal paperwork is late, which is
   * a worse failure than the one this fixes. Only a recorded `exitDate` ends the wage —
   * `status: RESIGNED` without one does not shorten the window, it makes `generate` refuse
   * (see D3b there), because a window needs a day and a status is not one.
   */
  private async employmentWindow(
    employee: Employee,
    periodMonth: string,
    from: Date,
    to: Date,
    offDays: ReadonlySet<number>,
  ): Promise<{ employedDays: number; periodDays: number; fraction: number }> {
    const holidayDates = this.holidays
      ? await this.holidays.listDates(employee.depotId, from, to)
      : [];
    const holidays = new Set(holidayDates);

    const join = employee.joinDate ? dayKey(employee.joinDate) : dayKey(from);
    const exit = employee.exitDate ? dayKey(employee.exitDate) : dayKey(to);
    const start = join > dayKey(from) ? join : dayKey(from);
    const end = exit < dayKey(to) ? exit : dayKey(to);

    const employedDays = workingDaysInRange(start, end, holidays, offDays).length;
    const [year, month] = periodMonth.split('-').map(Number);
    const periodDays = workingDaysInMonth(year, month, holidays, offDays);
    return {
      employedDays,
      periodDays,
      // A period with no working days at all (every day a holiday) must not divide by zero,
      // and the honest answer there is "a full share of nothing".
      fraction: periodDays > 0 ? employedDays / periodDays : 1,
    };
  }

  /** Expected working days in the period: calendar days − the rota's off days − holidays. */
  private async workingDays(
    periodMonth: string,
    depotId: string | null,
    from: Date,
    to: Date,
    offDays: ReadonlySet<number>,
  ): Promise<number> {
    const [year, month] = periodMonth.split('-').map(Number);
    const holidayDates = this.holidays ? await this.holidays.listDates(depotId, from, to) : [];
    return workingDaysInMonth(year, month, new Set(holidayDates), offDays);
  }

  /**
   * CA-1-38 — the rota HR actually built, for the employee and the period.
   *
   * Payroll used to read two depot-wide config values and nothing else: every employee of a
   * depot had the same standard day and the same weekly rest days, however carefully HR had
   * built the shift rotation on the /hr/shift screen. The rotation decided who was LATE
   * (attendance reads it, see domain/shift-rotation.ts) and then decided nothing about what
   * anybody was paid.
   *
   * The precedence mirrors attendance's, most specific first: the employee's own assignment
   * for the period, then their fixed shift, then the depot's, then the depot's configured
   * standard. A rotation names a shift per weekday, so a blank weekday IS that employee's
   * rest day and replaces the depot's CSV entirely — a rotation is a whole week, not a
   * supplement to one.
   *
   * A shift is a CLOCK SPAN, not a working day: "08:00–17:00" is nine hours of presence with
   * the break inside it, so the break comes off before it counts as a standard day. The
   * configured `standardWorkingMinutes` is already net (it ships as 480 = eight hours), so
   * nothing is taken off that one. The whole-period `standardMinutes` — the divisor behind
   * the overtime minute rate — is the shift span only when the rota is uniform; a rota that
   * mixes shift LENGTHS has no single "a day is this long", and inventing one would change
   * the wage divisor on a guess, so it falls back to the configured standard.
   */
  private async rotaFor(employee: Employee, from: Date): Promise<Rota> {
    const depotId = employee.depotId;
    const configStandard = this.config.standardWorkingMinutes(depotId);
    const offWeekdays = parseWeeklyOffDays(this.config.weeklyOffDays(depotId));
    /** Shift span by weekday, from a rotation; empty when the rota is a single shift. */
    const spans = new Map<number, number>();
    let flatSpan: number | null = null;

    if (this.shifts) {
      const inForce = assignmentInForce(
        await this.shifts.listAssignmentsUpTo(employee.id, from),
        from,
      );
      const rotation = inForce?.rotationId
        ? await this.shifts.findRotationById(inForce.rotationId)
        : null;
      if (rotation) {
        const pattern = parseRotationPattern(rotation.pattern);
        offWeekdays.clear();
        // De-duplicated: a weekly pattern names two or three shifts across seven days, and
        // this must not be seven queries.
        const byId = new Map<string, number>();
        for (let weekday = 0; weekday <= 6; weekday++) {
          const shiftId = pattern[weekday] ?? null;
          if (!shiftId) {
            offWeekdays.add(weekday);
            continue;
          }
          if (!byId.has(shiftId)) {
            const shift = await this.shifts.findById(shiftId);
            // A dangling id (see ShiftService.remove) means no span, not a zero-hour day.
            byId.set(shiftId, shift ? shiftSpanMinutes(shift.startTime, shift.endTime) : 0);
          }
          const span = byId.get(shiftId) ?? 0;
          if (span > 0) spans.set(weekday, span);
        }
      } else {
        const shiftId = inForce?.shiftId ?? employee.shiftId;
        const shift = shiftId
          ? await this.shifts.findById(shiftId)
          : await this.shifts.findActiveForDepot(depotId);
        const span = shift ? shiftSpanMinutes(shift.startTime, shift.endTime) : 0;
        flatSpan = span > 0 ? span : null;
      }
    }

    const netOf = (span: number, isFriday: boolean): number =>
      Math.max(0, span - this.config.breakMinutes(isFriday, depotId));
    const rostered = new Set<number>(spans.size > 0 ? spans.values() : []);
    if (flatSpan !== null) rostered.add(flatSpan);
    const uniformSpan = rostered.size === 1 ? [...rostered][0] : null;
    return {
      offWeekdays,
      standardMinutes: uniformSpan === null ? configStandard : netOf(uniformSpan, false),
      ruleFor: (weekday, offDay) => {
        const span = spans.get(weekday) ?? flatSpan;
        return {
          standardMinutes: span === null ? configStandard : netOf(span, weekday === FRIDAY),
          breakMinutes: this.config.breakMinutes(weekday === FRIDAY, depotId),
          offDay,
        };
      },
    };
  }

  private basePay(employee: Employee, presentDays: number, employedFraction = 1): number {
    if (employee.salaryType === 'DAILY') {
      const rate =
        employee.dailyRate != null
          ? Number(employee.dailyRate)
          : employee.employmentStatus === 'TRAINING'
            ? this.config.dailyRateTraining(employee.depotId)
            : 0;
      // DAILY already pays per day present, so a joiner is prorated by arithmetic that was
      // always correct. Applying the fraction on top would halve their wage twice.
      return Math.round(rate * presentDays);
    }
    // D3 — MONTHLY was a flat rate whatever slice of the month the person was employed for.
    // Someone joining on the 25th was paid the full month; someone leaving on the 3rd too.
    // A full-month employee has fraction === 1, so their payslip is unchanged to the rupiah.
    return employee.monthlyRate != null
      ? Math.round(Number(employee.monthlyRate) * employedFraction)
      : 0;
  }

  /**
   * D10 — generate a DRAFT payroll for every active employee of one depot.
   *
   * `POST /payroll/generate` takes a single `employeeId`, and the web page is one click per
   * person: a depot of thirty is thirty clicks, with no way to see who was missed. Missing
   * one person is the failure that matters — nobody notices an absent payslip until payday.
   *
   * Reuses `generate` per employee rather than reimplementing it, so every D2/D4/D5/D7 fix
   * applies here unchanged, and so does the next one. Approve and pay stay manual and
   * per-person: this moves no money, it only prepares drafts.
   *
   * Safe to re-run. `@@unique([employeeId, periodMonth])` plus the in-place DRAFT rewrite
   * make a second pass the same work rather than double work.
   *
   * One employee's failure must not decide the other twenty-nine's fate, so failures are
   * collected and returned by name instead of thrown. An empty list back means everyone
   * has a draft; a non-empty one is the list of people to look at.
   */
  async generateBatch(
    user: AuthenticatedUser,
    depotId: string,
    periodMonth: string,
  ): Promise<{ generated: number; failed: { employeeId: string; name: string; reason: string }[] }> {
    if (!PERIOD_RE.test(periodMonth)) {
      throw new BadRequestException('periodMonth harus format YYYY-MM');
    }
    // Once, here, rather than thirty identical failures collected one per employee.
    this.assertPeriodClosed(periodMonth);
    // Through `EmployeeService.list`, which applies `depotScopeIds` — a depot manager
    // cannot batch a depot that is not theirs, and does not need a second check here.
    const { rows } = await this.employees.list(user, {
      depotId,
      status: 'ACTIVE',
      page: 1,
      pageSize: 500,
    });

    let generated = 0;
    const failed: { employeeId: string; name: string; reason: string }[] = [];
    // Serial, deliberately: `generate` already fans its own reads out in parallel, and each
    // one is a transaction. Thirty of those at once is how a shared Postgres pool runs out
    // mid-run and leaves half a depot with drafts and no error anybody saw.
    for (const employee of rows) {
      try {
        await this.generate(user, employee.id, periodMonth);
        generated++;
      } catch (e) {
        failed.push({
          employeeId: employee.id,
          name: employee.fullName,
          reason: e instanceof Error ? e.message : 'Gagal membuat payroll',
        });
      }
    }
    return { generated, failed };
  }

  /**
   * CA-1-06 — a month that has not finished cannot be paid.
   *
   * Every number on the slip is reckoned over the WHOLE period: `employmentWindow` counts
   * the month's working days, and `autoAbsentDays` is that count minus the days somebody
   * turned up for. Generated on the 10th, the twenty days that have not happened yet are
   * twenty no-shows, and the absence fine is charged for all of them. Nothing warned about
   * it, and approving the draft locks it — `generate` refuses to re-run once a payroll
   * leaves DRAFT, so the wrong number is the final one.
   *
   * The month is cut in the business zone, not UTC: for the first seven hours of the 1st
   * WIB, `toISOString()` still names last month, and refusing to pay a month that HAS ended
   * is the same bug pointing the other way.
   */
  private assertPeriodClosed(periodMonth: string): void {
    // "YYYY-MM" sorts as it dates, so a string compare IS "this month or later".
    if (periodMonth >= localMonthKey(new Date(), this.config.timeZone)) {
      throw new BadRequestException(
        `Periode ${periodMonth} belum selesai. Payroll baru bisa dibuat setelah bulan itu berakhir.`,
      );
    }
  }

  /** [first-day, last-day] of a YYYY-MM as UTC-midnight dates (matches @db.Date storage). */
  /**
   * December's PPh 21: the year's real liability minus what the year already took.
   *
   * Reads the year to date off the employee's own earlier payslips (see
   * `pph21YearToDate`), so there is one record of what was withheld rather than two.
   * Over-withholding cannot be refunded through payroll — it is logged by name so it
   * reaches the person who files the 1721-A1, and December simply withholds nothing.
   */
  private async decemberPph21(
    employee: { id: string; depotId: string | null },
    input: StatutoryInput,
    decemberBpjsIdr: number,
    rates: StatutoryRates,
    periodMonth: string,
  ): Promise<number> {
    const year = Number(periodMonth.slice(0, 4));
    const ytd: Pph21YearToDate = await this.repo.pph21YearToDate(employee.id, year, periodMonth);
    const result = pph21December(input, ytd, decemberBpjsIdr, rates);
    if (result.overWithheldIdr > 0) {
      this.logger.warn(
        `Employee ${employee.id} over-withheld ${result.overWithheldIdr} for ${year}; ` +
          'payroll cannot refund tax — it is claimed on the annual filing (1721-A1).',
      );
    }
    return result.monthlyIdr;
  }

  private monthRange(periodMonth: string): { from: Date; to: Date } {
    const [y, m] = periodMonth.split('-').map(Number);
    return {
      from: new Date(Date.UTC(y, m - 1, 1)),
      to: new Date(Date.UTC(y, m, 0)),
    };
  }
}

/**
 * The LOCAL day key of a `@db.Date` value. Those are stored as UTC-midnight, so the UTC
 * slice IS the local date — `toLocaleDateString` would shift it back a day in WIB.
 */
function dayKey(d: Date): string {
  // tz-ok: @db.Date values are stored UTC-midnight, so the UTC slice IS the local day —
  // `toLocaleDateString` would shift it BACK a day in WIB.
  return d.toISOString().slice(0, 10);
}

/**
 * Shrink loan installments — newest first — until `net` is no longer negative, dropping any
 * line that ends up at zero rather than printing "Cicilan pinjaman 0" on a payslip.
 *
 * Only loans are touched: an installment not taken this month is still owed next month, so
 * deferring it costs nobody anything. A fine or a statutory withholding is not a debt that
 * can be moved, so those stay whole and the caller floors what is left.
 *
 * Mutates `items` (and the shared line objects in `loanLines`) and returns the new net.
 */
function deferLoanInstallments(
  items: PayrollItemInput[],
  loanLines: PayrollItemInput[],
  net: number,
): number {
  for (let i = loanLines.length - 1; i >= 0 && net < 0; i--) {
    const line = loanLines[i];
    const relief = Math.min(line.amount, -net);
    line.amount -= relief;
    net += relief;
    if (line.amount === 0) items.splice(items.indexOf(line), 1);
  }
  return net;
}

function sum(items: PayrollItemInput[], kind: PayrollItemInput['kind']): number {
  return items.filter((i) => i.kind === kind).reduce((t, i) => t + i.amount, 0);
}
