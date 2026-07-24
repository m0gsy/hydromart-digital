import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Bonus, Deduction, Employee, Payroll } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { PayrollRepository, PayrollWithItems, PayrollWrite } from '../../src/application/ports/payroll.repository';
import { AttendanceRepository, AttendanceSummary } from '../../src/application/ports/attendance.repository';
import { BonusRepository, DeductionRepository } from '../../src/application/ports/adjustment.repository';

const user: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };

class FakePayrollRepo implements PayrollRepository {
  existing: PayrollWithItems | null = null;
  byId: PayrollWithItems | null = null;
  lastWrite?: PayrollWrite;
  regenerated = false;
  status?: string;
  async findByEmployeeAndPeriod(): Promise<PayrollWithItems | null> {
    return this.existing;
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
    this.regenerated = true;
    return { id: 'p1', status: 'DRAFT', ...data } as unknown as PayrollWithItems;
  }
  async setStatus(_id: string, status: never): Promise<PayrollWithItems> {
    this.status = status;
    return { ...(this.byId as PayrollWithItems), status };
  }
  async list() {
    return { rows: [] as Payroll[], total: 0 };
  }
}

function build(opts: {
  employee: Partial<Employee>;
  summary?: AttendanceSummary;
  bonuses?: Partial<Bonus>[];
  deductions?: Partial<Deduction>[];
  repo?: FakePayrollRepo;
  absenceRate?: number;
  weeklyOff?: string;
  holidayDates?: string[];
}) {
  const repo = opts.repo ?? new FakePayrollRepo();
  const attendance: AttendanceRepository = {
    findByEmployeeAndDate: async () => null,
    findById: async () => null,
    upsertManual: async () => ({}) as never,
    recordAdjustment: async () => undefined,
    summary: async () => opts.summary ?? { presentDays: 0, lateDays: 0, leaveDays: 0 },
    create: async () => ({}) as never,
    patchCheckOut: async () => ({}) as never,
    list: async () => ({ rows: [], total: 0 }),
  };
  const bonuses: BonusRepository = {
    create: async () => ({}) as Bonus,
    listByEmployeePeriod: async () => (opts.bonuses ?? []) as Bonus[],
  };
  const deductions: DeductionRepository = {
    create: async () => ({}) as Deduction,
    listByEmployeePeriod: async () => (opts.deductions ?? []) as Deduction[],
  };
  const employees = {
    getById: async () => ({ id: 'e1', depotId: 'd1', salaryType: 'DAILY', ...opts.employee }) as Employee,
  } as unknown as EmployeeService;
  const config = {
    lateDeductionAmount: () => 10000,
    dailyRateTraining: () => 30000,
    absenceDeductionAmount: () => opts.absenceRate ?? 0,
    weeklyOffDays: () => opts.weeklyOff ?? '',
  } as unknown as HrConfigService;
  const holidays = { listDates: async () => opts.holidayDates ?? [] } as unknown as import('../../src/application/ports/holiday.repository').HolidayRepository;
  return { repo, svc: new PayrollService(repo, attendance, bonuses, deductions, employees, config, holidays) };
}

describe('PayrollService.generate', () => {
  it('DAILY base = dailyRate × presentDays; net folds bonus and deductions', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 50000 as never },
      summary: { presentDays: 20, lateDays: 2, leaveDays: 0 },
      bonuses: [{ id: 'b1', type: 'MANUAL', amount: 100000 as never, note: 'THR' }],
      deductions: [{ id: 'd1', type: 'CASH_ADVANCE', amount: 50000 as never, note: 'Kasbon' }],
    });
    await svc.generate(user, 'e1', '2026-07');
    const w = repo.lastWrite!;
    expect(w.gross).toBe(1_000_000); // 50k × 20
    expect(w.totalBonus).toBe(100_000);
    expect(w.totalDeduction).toBe(20_000 + 50_000); // late 2×10k + kasbon 50k
    expect(w.net).toBe(1_000_000 + 100_000 - 70_000);
    expect(w.items.filter((i) => i.kind === 'DEDUCTION')).toHaveLength(2);
  });

  it('TRAINING with no dailyRate falls back to the config training rate', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: null, employmentStatus: 'TRAINING' as never },
      summary: { presentDays: 10, lateDays: 0, leaveDays: 0 },
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.gross).toBe(300_000); // 30k × 10
  });

  it('MONTHLY base = monthlyRate regardless of present days', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      summary: { presentDays: 18, lateDays: 5, leaveDays: 0 },
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.gross).toBe(4_000_000);
    expect(repo.lastWrite!.totalDeduction).toBe(50_000); // 5 late × 10k
  });

  it('MONTHLY auto-absence: deducts (workingDays − present − leave) × absenceRate', async () => {
    // July 2026 = 31 days; no weekly-off, one holiday → 30 working days. 20 present + 2 leave
    // → 8 absent × 25k = 200k, on top of 5 late × 10k = 50k.
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      summary: { presentDays: 20, lateDays: 5, leaveDays: 2 },
      absenceRate: 25_000,
      holidayDates: ['2026-07-17'],
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.totalDeduction).toBe(250_000); // 200k absence + 50k late
  });

  it('DAILY never gets an absence deduction (missing days already earn nothing)', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      summary: { presentDays: 5, lateDays: 0, leaveDays: 0 },
      absenceRate: 25_000,
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.totalDeduction).toBe(0);
  });

  it('rejects a malformed period', async () => {
    const { svc } = build({ employee: {} });
    await expect(svc.generate(user, 'e1', '2026-13')).rejects.toThrow(BadRequestException);
  });

  it('re-generates a DRAFT in place but refuses a locked (APPROVED) payroll', async () => {
    const draft = build({ employee: { dailyRate: 1000 as never }, summary: { presentDays: 1, lateDays: 0, leaveDays: 0 } });
    draft.repo.existing = { id: 'p1', status: 'DRAFT' } as PayrollWithItems;
    await draft.svc.generate(user, 'e1', '2026-07');
    expect(draft.repo.regenerated).toBe(true);

    const locked = build({ employee: {} });
    locked.repo.existing = { id: 'p1', status: 'APPROVED' } as PayrollWithItems;
    await expect(locked.svc.generate(user, 'e1', '2026-07')).rejects.toThrow(ConflictException);
  });
});

describe('PayrollService lifecycle', () => {
  it('approve DRAFT→APPROVED, then pay APPROVED→PAID', async () => {
    const { repo, svc } = build({ employee: {} });
    repo.byId = { id: 'p1', employeeId: 'e1', status: 'DRAFT' } as PayrollWithItems;
    await svc.approve(user, 'p1');
    expect(repo.status).toBe('APPROVED');

    repo.byId = { id: 'p1', employeeId: 'e1', status: 'APPROVED' } as PayrollWithItems;
    await svc.markPaid(user, 'p1');
    expect(repo.status).toBe('PAID');
  });

  it('refuses approving a non-DRAFT and paying a non-APPROVED', async () => {
    const { repo, svc } = build({ employee: {} });
    repo.byId = { id: 'p1', employeeId: 'e1', status: 'PAID' } as PayrollWithItems;
    await expect(svc.approve(user, 'p1')).rejects.toThrow(ConflictException);
    repo.byId = { id: 'p1', employeeId: 'e1', status: 'DRAFT' } as PayrollWithItems;
    await expect(svc.markPaid(user, 'p1')).rejects.toThrow(ConflictException);
  });
});
