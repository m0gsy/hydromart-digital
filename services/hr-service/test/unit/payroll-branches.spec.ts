import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

// pdfkit is a runtime dep not installed in dev/CI node_modules — virtual-mock it so slip()
// resolves deterministically regardless of whether the real package is present.
jest.mock(
  'pdfkit',
  () =>
    class FakePdfDoc {
      private handlers: Record<string, (c?: Buffer) => void> = {};
      fontSize(): this {
        return this;
      }
      text(): this {
        return this;
      }
      moveDown(): this {
        return this;
      }
      on(event: string, cb: (c?: Buffer) => void): this {
        this.handlers[event] = cb;
        return this;
      }
      end(): void {
        this.handlers['data']?.(Buffer.from('%PDF-fake'));
        this.handlers['end']?.();
      }
    },
);

import { Allowance, BonusRule, Employee, Loan, Payroll } from '../../prisma/generated/client';
import { AllowanceRepository } from '../../src/application/ports/allowance.repository';
import { HrConfigService } from '../../src/config/hr-config.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import {
  PayrollRepository,
  PayrollWithItems,
  PayrollWrite,
} from '../../src/application/ports/payroll.repository';
import {
  AttendanceRepository,
  AttendanceSummary,
} from '../../src/application/ports/attendance.repository';
import {
  BonusRepository,
  DeductionRepository,
} from '../../src/application/ports/adjustment.repository';
import { BonusRuleRepository } from '../../src/application/ports/bonus-rule.repository';
import { LoanRepository } from '../../src/application/ports/loan.repository';
import { HolidayRepository } from '../../src/application/ports/holiday.repository';
import { SalesPort } from '../../src/application/ports/sales.port';

const user: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };

class FakePayrollRepo implements PayrollRepository {
  /**
   * December's reconciliation reads the year off the employee's earlier payslips. A fake
   * just states the answer: tests that care set `ytd`, and everything else gets a year
   * with nothing in it, which is what a first-December employee actually has.
   */
  ytd = { grossIdr: 0, bpjsIdr: 0, withheldIdr: 0, months: 0 };
  async pph21YearToDate(): Promise<{
    grossIdr: number;
    bpjsIdr: number;
    withheldIdr: number;
    months: number;
  }> {
    return this.ytd;
  }
  byId: PayrollWithItems | null = null;
  lastWrite?: PayrollWrite;
  lastListFilter?: unknown;
  async findByEmployeeAndPeriod(): Promise<PayrollWithItems | null> {
    return null;
  }
  async findById(): Promise<PayrollWithItems | null> {
    return this.byId;
  }
  async create(data: PayrollWrite): Promise<PayrollWithItems> {
    this.lastWrite = data;
    return { id: 'p1', status: 'DRAFT', ...data } as unknown as PayrollWithItems;
  }
  async regenerate(_id: string, data: PayrollWrite): Promise<PayrollWithItems> {
    this.lastWrite = data;
    return { id: 'p1', status: 'DRAFT', ...data } as unknown as PayrollWithItems;
  }
  async setStatus(): Promise<PayrollWithItems> {
    return this.byId as PayrollWithItems;
  }
  async list(filter: unknown) {
    this.lastListFilter = filter;
    // PG-01: rows carry the name of the person they pay.
    return { rows: [] as (Payroll & { employeeName: string | null })[], total: 0 };
  }
  /** What earlier payslips actually took for each loan (D4). Empty = nothing collected yet. */
  repaid = new Map<string, number>();
  async deductedBySourceRefBefore(): Promise<Map<string, number>> {
    return this.repaid;
  }
}

function build(opts: {
  employee: Partial<Employee>;
  summary?: AttendanceSummary;
  rules?: Partial<BonusRule>[];
  loans?: Partial<Loan>[];
  /** D4: IDR already taken for each loan id in earlier periods. */
  repaid?: Record<string, number>;
  ladder?: string;
  sales?: number | null;
  allowances?: Partial<Allowance>[];
  workedMinutes?: { workDate: string; workingMinutes: number | null }[];
  bonusRows?: { id: string; type: string; amount: number; note: string | null }[];
  deductionRows?: { id: string; type: string; amount: number; note: string | null }[];
  /** Deploys without the holiday table wired (the port is optional). */
  noHolidays?: boolean;
  /** Depot SOP §2 tiered fines, `tier1,tier2,absent`. Empty = the flat branch. */
  fines?: string;
}) {
  const repo = new FakePayrollRepo();
  if (opts.repaid) repo.repaid = new Map(Object.entries(opts.repaid));
  const attendance = {
    summary: async (): Promise<AttendanceSummary> =>
      opts.summary ?? { presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 },
    listWorkedMinutes: async () =>
      (opts.workedMinutes ?? []).map((d) => ({
        workDate: new Date(`${d.workDate}T00:00:00.000Z`),
        workingMinutes: d.workingMinutes,
        lateMinutes: 0,
      })),
  } as unknown as AttendanceRepository;
  const bonuses = {
    listByEmployeePeriod: async () => opts.bonusRows ?? [],
  } as unknown as BonusRepository;
  const deductions = {
    listByEmployeePeriod: async () => opts.deductionRows ?? [],
  } as unknown as DeductionRepository;
  const employees = {
    getById: async () =>
      ({
        id: 'e1',
        depotId: 'd1',
        salaryType: 'DAILY',
        employeeCode: 'HR-0001',
        fullName: 'Budi',
        ...opts.employee,
      }) as Employee,
  } as unknown as EmployeeService;
  const config = {
    lateDeductionAmount: () => 10000,
    dailyRateTraining: () => 30000,
    absenceDeductionAmount: () => 0,
    weeklyOffDays: () => '',
    tenureRaiseLadder: () => opts.ladder ?? '',
    standardWorkingMinutes: () => 480,
    // D2: 60 minutes unpaid break, 90 on Friday. Stubbed to 0 here so every pre-existing
    // arithmetic case keeps asserting what it was written to assert; the break itself is
    // covered by overtime.spec.ts, which exercises both values directly.
    breakMinutes: () => 0,
    overtimeMultiplierPct: () => 150,
    overtimeOffDayMultiplierPct: () => 200,
    // Depot SOP settings stay off here — these fixtures pin the OLD payroll.
    dailySalesBonusTiers: () => '',
    lateFineCsv: () => opts.fines ?? '',
    lateTier2AfterMinutes: () => 30,
    absentAfterMinutes: () => 0,
    // Q-13: the real statutory defaults, not zeroes. Fixtures without a BPJS number or a
    // PTKP status deduct nothing anyway (enrolment gates BPJS, PTKP gates PPh 21), so the
    // existing assertions are untouched — while a test that DOES enrol someone gets the
    // lawful numbers rather than a convenient fiction.
    pph21TerTable: () => ({}),
    statutoryRates: () => ({
      healthEmployeePct: 1,
      healthCeilingIdr: 12_000_000,
      jhtEmployeePct: 2,
      jpEmployeePct: 1,
      jpCeilingIdr: 10_547_400,
      occupationalCostPct: 5,
      occupationalCostCapIdr: 500_000,
      noNpwpSurchargePct: 20,
    }),
  } as unknown as HrConfigService;
  const holidays = opts.noHolidays
    ? undefined
    : ({ listDates: async () => [] } as unknown as HolidayRepository);
  const bonusRules = opts.rules
    ? ({
        listActiveForDepot: async () => opts.rules as BonusRule[],
      } as unknown as BonusRuleRepository)
    : undefined;
  const loans = opts.loans
    ? ({ listActiveByEmployee: async () => opts.loans as Loan[] } as unknown as LoanRepository)
    : undefined;
  const sales =
    opts.sales !== undefined
      ? ({ depotSales: async () => opts.sales } as unknown as SalesPort)
      : undefined;
  const allowances = opts.allowances
    ? ({
        listActiveForPeriod: async () => opts.allowances as Allowance[],
      } as unknown as AllowanceRepository)
    : undefined;
  const svc = new PayrollService(
    repo,
    attendance,
    bonuses,
    deductions,
    employees,
    config,
    holidays,
    bonusRules,
    loans,
    sales,
    allowances,
  );
  return { repo, svc };
}

describe('PayrollService tenure raise (Rule-E)', () => {
  it('adds a tenure uplift line for a depot manager', async () => {
    const { repo, svc } = build({
      employee: {
        salaryType: 'DAILY',
        dailyRate: 100_000 as never,
        // The raise follows the JABATAN now, not the employment status.
        role: 'KEPALA_DEPOT' as never,
        joinDate: new Date('2023-01-01') as never,
      },
      ladder: '1:5,2:10',
    });
    await svc.generate(user, 'e1', '2026-07');
    const raise = repo.lastWrite!.items.find((i) => i.label.startsWith('Kenaikan masa kerja'));
    expect(raise?.amount).toBe(200_000); // 10% of 2,000,000
    expect(repo.lastWrite!.gross).toBe(2_200_000);
  });

  it('adds no uplift when the ladder yields 0%', async () => {
    const { repo, svc } = build({
      employee: {
        salaryType: 'DAILY',
        dailyRate: 100_000 as never,
        // The raise follows the JABATAN now, not the employment status.
        role: 'KEPALA_DEPOT' as never,
        joinDate: new Date('2026-06-01') as never,
      },
      ladder: '5:20',
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Kenaikan masa kerja'))).toBe(
      false,
    );
  });
});

describe('PayrollService auto-bonus rules (Rule-F)', () => {
  it('pays a present-days rule and a sales rule (fetching sales only when needed)', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      rules: [
        {
          id: 'r1',
          name: 'Rajin Hadir',
          metric: 'PRESENT_DAYS',
          op: 'GTE',
          threshold: 1 as never,
          rewardKind: 'FIXED',
          rewardValue: 50_000 as never,
        },
        {
          id: 'r2',
          name: 'Bonus Sales',
          metric: 'SALES_TOTAL',
          op: 'GTE',
          threshold: 1 as never,
          rewardKind: 'FIXED',
          rewardValue: 25_000 as never,
        },
      ],
      sales: 5_000_000,
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.totalBonus).toBe(75_000);
    expect(
      repo
        .lastWrite!.items.filter((i) => i.kind === 'BONUS')
        .map((i) => i.label)
        .sort(),
    ).toEqual(['Bonus Sales', 'Rajin Hadir']);
  });

  it('skips a rule that does not pay and never calls sales when no SALES rule exists', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      rules: [
        {
          id: 'r1',
          name: 'Nihil',
          metric: 'PRESENT_DAYS',
          op: 'GTE',
          threshold: 999 as never,
          rewardKind: 'FIXED',
          rewardValue: 50_000 as never,
        },
      ],
      sales: null,
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.totalBonus).toBe(0);
  });
});

describe('PayrollService auto loan/kasbon (Rule-G)', () => {
  it('deducts the per-period installment for active loans', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      loans: [
        {
          id: 'l1',
          principal: 1_000_000 as never,
          installmentAmount: 300_000 as never,
          startPeriod: '2026-07',
          note: 'Kasbon' as never,
        },
        {
          id: 'l2',
          principal: 500_000 as never,
          installmentAmount: 100_000 as never,
          startPeriod: '2026-07',
          note: null as never,
        },
        {
          id: 'l3',
          principal: 500_000 as never,
          installmentAmount: 100_000 as never,
          startPeriod: '2026-12',
          note: null as never,
        }, // future → 0, skipped
      ],
    });
    await svc.generate(user, 'e1', '2026-07');
    const deductions = repo.lastWrite!.items.filter((i) => i.kind === 'DEDUCTION');
    expect(deductions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Cicilan: Kasbon', amount: 300_000 }),
        expect.objectContaining({ label: 'Cicilan pinjaman', amount: 100_000 }),
      ]),
    );
    expect(deductions).toHaveLength(2); // l3 contributes nothing
  });
});

// D4: net was `gross + bonus − deduction` with no floor at all. Fines, kasbon installments,
// BPJS and PPh 21 stack without any check against what the employee actually earned, so a
// trainee on the daily training rate could be handed a NEGATIVE payslip — a bill from their
// employer — and it was stored as-is in a Decimal(12,2).
describe('PayrollService net floor and loan rollover (D4)', () => {
  const kasbon = {
    id: 'l1',
    principal: 1_000_000 as never,
    installmentAmount: 300_000 as never,
    startPeriod: '2026-07',
    note: 'Kasbon' as never,
  };

  it('clips the installment to what was earned instead of writing a negative net', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 30_000 as never },
      summary: { presentDays: 2, lateDays: 0, leaveDays: 0, pendingDays: 0 }, // gross 60.000
      loans: [kasbon],
    });
    await svc.generate(user, 'e1', '2026-07');
    const w = repo.lastWrite!;
    expect(w.net).toBe(0);
    // 300.000 asked, 60.000 available: take the 60.000, the rest rolls to the next period.
    expect(w.items.find((i) => i.label === 'Cicilan: Kasbon')!.amount).toBe(60_000);
    expect(w.totalDeduction).toBe(60_000);
  });

  it('drops an installment it cannot take at all rather than printing a zero line', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 30_000 as never },
      summary: { presentDays: 0, lateDays: 0, leaveDays: 0, pendingDays: 0 },
      loans: [kasbon],
    });
    await svc.generate(user, 'e1', '2026-07');
    const w = repo.lastWrite!;
    expect(w.net).toBe(0);
    expect(w.items.filter((i) => i.kind === 'DEDUCTION')).toEqual([]);
    expect(w.totalDeduction).toBe(0);
  });

  it('still floors net at 0 when the un-deferrable deductions alone exceed the pay', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 30_000 as never },
      // One day worked, five days late: 5 × 10.000 flat lateness > 30.000 earned.
      summary: { presentDays: 1, lateDays: 5, leaveDays: 0, pendingDays: 0 },
    });
    await svc.generate(user, 'e1', '2026-07');
    const w = repo.lastWrite!;
    expect(w.net).toBe(0);
    // The fine stays on the slip at full value — it was assessed, it just could not be
    // collected out of this month's pay. Only loan installments roll forward.
    expect(w.totalDeduction).toBe(50_000);
  });

  it('collects what is still owed, not what the elapsed months assume', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 200_000 as never },
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 },
      // Started 2026-04, so by 2026-08 five installments have "elapsed" and the old
      // arithmetic calls the loan settled. The ledger says only 600.000 was ever taken.
      loans: [{ ...kasbon, startPeriod: '2026-04' }],
      repaid: { l1: 600_000 },
    });
    await svc.generate(user, 'e1', '2026-08');
    expect(repo.lastWrite!.items.find((i) => i.label === 'Cicilan: Kasbon')).toMatchObject({
      amount: 300_000,
    });
  });

  it('takes only the final stub when the ledger shows the loan nearly cleared', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 200_000 as never },
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 },
      loans: [{ ...kasbon, startPeriod: '2026-04' }],
      repaid: { l1: 900_000 },
    });
    await svc.generate(user, 'e1', '2026-08');
    expect(repo.lastWrite!.items.find((i) => i.label === 'Cicilan: Kasbon')).toMatchObject({
      amount: 100_000,
    });
  });
});

describe('PayrollService.load / slip / getById / list', () => {
  it('404s when the payroll is missing', async () => {
    const { svc } = build({ employee: {} });
    await expect(svc.getById(user, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('slip renders the payroll into a PDF buffer', async () => {
    const { repo, svc } = build({ employee: {} });
    repo.byId = {
      id: 'p1',
      employeeId: 'e1',
      periodMonth: '2026-07',
      status: 'APPROVED',
      net: 1_000_000,
      items: [
        { kind: 'BASE', label: 'Gaji pokok', amount: 1_100_000 },
        { kind: 'DEDUCTION', label: 'Potongan', amount: 100_000 },
      ],
    } as unknown as PayrollWithItems;
    const pdf = await svc.slip(user, 'p1');
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-'); // pdfkit output header
  });

  it('list forwards pagination to the repo', async () => {
    const { repo, svc } = build({ employee: {} });
    await svc.list(user, { periodMonth: '2026-07', page: 3, pageSize: 25 });
    expect(repo.lastListFilter).toMatchObject({ periodMonth: '2026-07', skip: 50, take: 25 });
  });
});

describe('PayrollService allowances (A3)', () => {
  const TRANSPORT = {
    id: 'al-1',
    type: 'TRANSPORT',
    amount: 300_000 as never,
    note: null,
  } as Partial<Allowance>;

  it('pays an allowance as its own line and counts it into gross, not into bonus', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      allowances: [TRANSPORT],
    });
    await svc.generate(user, 'e1', '2026-07');
    const w = repo.lastWrite!;
    const line = w.items.find((i) => i.kind === 'ALLOWANCE');
    expect(line).toMatchObject({
      label: 'Tunjangan TRANSPORT',
      amount: 300_000,
      sourceRef: 'al-1',
    });
    expect(w.gross).toBe(4_300_000);
    expect(w.totalBonus).toBe(0);
    expect(w.net).toBe(4_300_000);
  });

  it('labels the line with the note when there is one', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      allowances: [{ ...TRANSPORT, note: 'Tunjangan rute jauh' }],
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.items.find((i) => i.kind === 'ALLOWANCE')!.label).toBe(
      'Tunjangan rute jauh',
    );
  });

  it('leaves a percent-of-salary bonus rule on basic pay only', async () => {
    // Rule: 10% of base pay when present days ≥ 1. With a 300k allowance in play the bonus
    // must stay 400k (10% of 4,000,000), not 430k.
    const rule = {
      id: 'r1',
      name: 'Bonus kehadiran',
      metric: 'PRESENT_DAYS',
      op: 'GTE',
      threshold: 1 as never,
      rewardKind: 'PERCENT',
      rewardValue: 10 as never,
    };
    const withAllowance = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      rules: [rule],
      allowances: [TRANSPORT],
    });
    await withAllowance.svc.generate(user, 'e1', '2026-07');
    const bonusWith = withAllowance.repo.lastWrite!.totalBonus;

    const without = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      rules: [rule],
    });
    await without.svc.generate(user, 'e1', '2026-07');

    expect(bonusWith).toBe(400_000);
    expect(bonusWith).toBe(without.repo.lastWrite!.totalBonus);
  });

  it('pays identical overtime to two people on the same basic pay, allowance or not', async () => {
    const worked = [{ workDate: '2026-07-06', workingMinutes: 600 }];
    const paid = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      workedMinutes: worked,
      allowances: [TRANSPORT],
    });
    await paid.svc.generate(user, 'e1', '2026-07');
    const plain = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      workedMinutes: worked,
    });
    await plain.svc.generate(user, 'e1', '2026-07');

    const overtime = (w: typeof paid.repo.lastWrite) =>
      w!.items.find((i) => i.label.startsWith('Lembur'))!.amount;
    expect(overtime(paid.repo.lastWrite)).toBe(54_000);
    expect(overtime(paid.repo.lastWrite)).toBe(overtime(plain.repo.lastWrite));
  });

  it('adds nothing when the employee has no allowance repository wired', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.items.some((i) => i.kind === 'ALLOWANCE')).toBe(false);
    expect(repo.lastWrite!.gross).toBe(4_000_000);
  });
});

// The pay shapes nobody had generated: a manual bonus/deduction row with and without its own
// note, a trainee with no rate of their own, a monthly employee with no rate stored at all,
// and a deployment with no holiday table wired.
describe('PayrollService remaining pay shapes', () => {
  const basicOf = (w: PayrollWrite | undefined): number | undefined =>
    w?.items.find((i) => i.kind === 'BASE')?.amount;

  it('labels manual bonus and deduction lines by note, falling back to the type', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      bonusRows: [
        { id: 'b1', type: 'THR', amount: 500_000, note: 'THR Idulfitri' },
        { id: 'b2', type: 'LAINNYA', amount: 100_000, note: null },
      ],
      deductionRows: [
        { id: 'd1', type: 'BPJS', amount: 50_000, note: 'BPJS Juli' },
        { id: 'd2', type: 'LAINNYA', amount: 25_000, note: null },
      ],
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['THR Idulfitri', 'Bonus LAINNYA', 'BPJS Juli', 'Potongan LAINNYA']),
    );
  });

  it('pays a trainee with no rate of their own at the training day rate', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: null, employmentStatus: 'TRAINING' as never },
      summary: { presentDays: 10, lateDays: 0, leaveDays: 0, pendingDays: 0 },
      workedMinutes: [{ workDate: '2026-07-06', workingMinutes: 600 }],
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(basicOf(repo.lastWrite)).toBe(300_000); // 10 days at 30.000
    expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Lembur'))).toBe(true);
  });

  it('adds no overtime line when there is no rate to price it with', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: null },
      workedMinutes: [{ workDate: '2026-07-06', workingMinutes: 600 }],
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Lembur'))).toBe(false);
  });

  it('pays a monthly employee with no stored rate nothing, rather than NaN', async () => {
    const { repo, svc } = build({ employee: { salaryType: 'MONTHLY', monthlyRate: null } });
    await svc.generate(user, 'e1', '2026-07');
    expect(basicOf(repo.lastWrite)).toBe(0);
  });

  it('generates payroll on a deployment with no holiday table wired', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      workedMinutes: [{ workDate: '2026-07-06', workingMinutes: 600 }],
      noHolidays: true,
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(basicOf(repo.lastWrite)).toBe(2_000_000);
  });
});
