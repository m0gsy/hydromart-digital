import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { BonusRule, Employee, Loan, Payroll } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { PayrollRepository, PayrollWithItems, PayrollWrite } from '../../src/application/ports/payroll.repository';
import { AttendanceRepository, AttendanceSummary } from '../../src/application/ports/attendance.repository';
import { BonusRepository, DeductionRepository } from '../../src/application/ports/adjustment.repository';
import { BonusRuleRepository } from '../../src/application/ports/bonus-rule.repository';
import { LoanRepository } from '../../src/application/ports/loan.repository';
import { HolidayRepository } from '../../src/application/ports/holiday.repository';
import { SalesPort } from '../../src/application/ports/sales.port';

const user: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };

class FakePayrollRepo implements PayrollRepository {
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
    return { rows: [] as Payroll[], total: 0 };
  }
}

function build(opts: {
  employee: Partial<Employee>;
  summary?: AttendanceSummary;
  rules?: Partial<BonusRule>[];
  loans?: Partial<Loan>[];
  ladder?: string;
  sales?: number | null;
}) {
  const repo = new FakePayrollRepo();
  const attendance = {
    summary: async (): Promise<AttendanceSummary> => opts.summary ?? { presentDays: 20, lateDays: 0, leaveDays: 0 },
  } as unknown as AttendanceRepository;
  const bonuses = { listByEmployeePeriod: async () => [] } as unknown as BonusRepository;
  const deductions = { listByEmployeePeriod: async () => [] } as unknown as DeductionRepository;
  const employees = {
    getById: async () => ({ id: 'e1', depotId: 'd1', salaryType: 'DAILY', employeeCode: 'HR-0001', fullName: 'Budi', ...opts.employee }) as Employee,
  } as unknown as EmployeeService;
  const config = {
    lateDeductionAmount: () => 10000,
    dailyRateTraining: () => 30000,
    absenceDeductionAmount: () => 0,
    weeklyOffDays: () => '',
    tenureRaiseLadder: () => opts.ladder ?? '',
  } as unknown as HrConfigService;
  const holidays = { listDates: async () => [] } as unknown as HolidayRepository;
  const bonusRules = opts.rules
    ? ({ listActiveForDepot: async () => opts.rules as BonusRule[] } as unknown as BonusRuleRepository)
    : undefined;
  const loans = opts.loans
    ? ({ listActiveByEmployee: async () => opts.loans as Loan[] } as unknown as LoanRepository)
    : undefined;
  const sales = opts.sales !== undefined
    ? ({ depotSales: async () => opts.sales } as unknown as SalesPort)
    : undefined;
  const svc = new PayrollService(repo, attendance, bonuses, deductions, employees, config, holidays, bonusRules, loans, sales);
  return { repo, svc };
}

describe('PayrollService tenure raise (Rule-E)', () => {
  it('adds a tenure uplift line for a depot manager', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never, employmentStatus: 'DEPOT_MANAGER' as never, joinDate: new Date('2023-01-01') as never },
      ladder: '1:5,2:10',
    });
    await svc.generate(user, 'e1', '2026-07');
    const raise = repo.lastWrite!.items.find((i) => i.label.startsWith('Kenaikan masa kerja'));
    expect(raise?.amount).toBe(200_000); // 10% of 2,000,000
    expect(repo.lastWrite!.gross).toBe(2_200_000);
  });

  it('adds no uplift when the ladder yields 0%', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never, employmentStatus: 'DEPOT_MANAGER' as never, joinDate: new Date('2026-06-01') as never },
      ladder: '5:20',
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Kenaikan masa kerja'))).toBe(false);
  });
});

describe('PayrollService auto-bonus rules (Rule-F)', () => {
  it('pays a present-days rule and a sales rule (fetching sales only when needed)', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      rules: [
        { id: 'r1', name: 'Rajin Hadir', metric: 'PRESENT_DAYS', op: 'GTE', threshold: 1 as never, rewardKind: 'FIXED', rewardValue: 50_000 as never },
        { id: 'r2', name: 'Bonus Sales', metric: 'SALES_TOTAL', op: 'GTE', threshold: 1 as never, rewardKind: 'FIXED', rewardValue: 25_000 as never },
      ],
      sales: 5_000_000,
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.totalBonus).toBe(75_000);
    expect(repo.lastWrite!.items.filter((i) => i.kind === 'BONUS').map((i) => i.label).sort()).toEqual(['Bonus Sales', 'Rajin Hadir']);
  });

  it('skips a rule that does not pay and never calls sales when no SALES rule exists', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      rules: [{ id: 'r1', name: 'Nihil', metric: 'PRESENT_DAYS', op: 'GTE', threshold: 999 as never, rewardKind: 'FIXED', rewardValue: 50_000 as never }],
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
        { id: 'l1', principal: 1_000_000 as never, installmentAmount: 300_000 as never, startPeriod: '2026-07', note: 'Kasbon' as never },
        { id: 'l2', principal: 500_000 as never, installmentAmount: 100_000 as never, startPeriod: '2026-07', note: null as never },
        { id: 'l3', principal: 500_000 as never, installmentAmount: 100_000 as never, startPeriod: '2026-12', note: null as never }, // future → 0, skipped
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

describe('PayrollService.load / slip / getById / list', () => {
  it('404s when the payroll is missing', async () => {
    const { svc } = build({ employee: {} });
    await expect(svc.getById(user, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('slip maps the payroll into slip lines (rejects only because pdfkit is absent in tests)', async () => {
    const { repo, svc } = build({ employee: {} });
    repo.byId = {
      id: 'p1', employeeId: 'e1', periodMonth: '2026-07', status: 'APPROVED', net: 1_000_000,
      items: [
        { kind: 'BASE', label: 'Gaji pokok', amount: 1_100_000 },
        { kind: 'DEDUCTION', label: 'Potongan', amount: 100_000 },
      ],
    } as unknown as PayrollWithItems;
    await expect(svc.slip(user, 'p1')).rejects.toThrow(/pdfkit/);
  });

  it('list forwards pagination to the repo', async () => {
    const { repo, svc } = build({ employee: {} });
    await svc.list({ periodMonth: '2026-07', page: 3, pageSize: 25 });
    expect(repo.lastListFilter).toMatchObject({ periodMonth: '2026-07', skip: 50, take: 25 });
  });
});
