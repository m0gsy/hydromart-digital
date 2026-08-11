import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Bonus, Deduction, Employee, Payroll } from '../../prisma/generated/client';
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
  async setStatus(_id: string, _from: never, status: never): Promise<PayrollWithItems> {
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
  /** M24-17: clocked minutes per attended day (+ SOP: minutes late on that day). */
  workedMinutes?: { workDate: string; workingMinutes: number | null; lateMinutes?: number }[];
  overtimePct?: number;
  overtimeOffDayPct?: number;
  /** Depot SOP daily gallon bonus ladder; '' (the default) = feature off. */
  gallonTiers?: string;
  /** Gallons the depot sold per local day; null = order-service unavailable. */
  dailyGallons?: Record<string, number> | null;
  /** A whole SalesPort double, for asserting the call was (or was not) made. */
  salesPort?: import('../../src/application/ports/sales.port').SalesPort;
}) {
  const repo = opts.repo ?? new FakePayrollRepo();
  const attendance: AttendanceRepository = {
    findByEmployeeAndDate: async () => null,
    findById: async () => null,
    upsertManual: async () => ({}) as never,
    patchStatus: async () => ({}) as never,
    recordAdjustment: async () => undefined,
    summary: async () => opts.summary ?? { presentDays: 0, lateDays: 0, leaveDays: 0 },
    summaryMany: async () => new Map(),
    listWorkedMinutes: async () =>
      (opts.workedMinutes ?? []).map((d) => ({
        workDate: new Date(`${d.workDate}T00:00:00.000Z`),
        workingMinutes: d.workingMinutes,
        lateMinutes: d.lateMinutes ?? 0,
      })),
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
    getById: async () =>
      ({ id: 'e1', depotId: 'd1', salaryType: 'DAILY', ...opts.employee }) as Employee,
  } as unknown as EmployeeService;
  const config = {
    lateDeductionAmount: () => 10000,
    dailyRateTraining: () => 30000,
    absenceDeductionAmount: () => opts.absenceRate ?? 0,
    weeklyOffDays: () => opts.weeklyOff ?? '',
    standardWorkingMinutes: () => 480,
    overtimeMultiplierPct: () => opts.overtimePct ?? 150,
    overtimeOffDayMultiplierPct: () => opts.overtimeOffDayPct ?? 200,
    dailySalesBonusTiers: () => opts.gallonTiers ?? '',
    // Q-13: the real statutory defaults, not zeroes. Fixtures without a BPJS number or a
    // PTKP status deduct nothing anyway (enrolment gates BPJS, PTKP gates PPh 21), so the
    // existing assertions are untouched — while a test that DOES enrol someone gets the
    // lawful numbers rather than a convenient fiction.
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
  const holidays = {
    listDates: async () => opts.holidayDates ?? [],
  } as unknown as import('../../src/application/ports/holiday.repository').HolidayRepository;
  const sales =
    opts.salesPort ??
    (opts.dailyGallons === undefined
      ? undefined
      : ({
          depotSales: async () => null,
          depotDailyGallons: async () =>
            opts.dailyGallons === null ? null : new Map(Object.entries(opts.dailyGallons!)),
        } as import('../../src/application/ports/sales.port').SalesPort));
  return {
    repo,
    svc: new PayrollService(
      repo,
      attendance,
      bonuses,
      deductions,
      employees,
      config,
      holidays,
      undefined,
      undefined,
      sales,
    ),
  };
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

  // Q-13: net used to be gross + bonus − (lateness, absence, manual rows, loans). No
  // BPJS, no PPh 21 — so every payslip overstated take-home pay and the company
  // under-withheld tax it is on the hook for.
  describe('statutory deductions', () => {
    const enrolled = {
      salaryType: 'MONTHLY' as const,
      monthlyRate: 5_000_000 as never,
      bpjsKes: '0001234567890',
      bpjsTk: '9987654321',
      ptkpStatus: 'TK0' as never,
      npwp: '09.254.294.3-407.000',
    };

    it('withholds BPJS and PPh 21, and takes them out of net', async () => {
      const { repo, svc } = build({
        employee: enrolled,
        summary: { presentDays: 31, lateDays: 0, leaveDays: 0 },
      });
      await svc.generate(user, 'e1', '2026-07');
      const w = repo.lastWrite!;

      expect(w.items.filter((i) => i.kind === 'DEDUCTION').map((i) => [i.label, i.amount])).toEqual(
        [
          ['BPJS Kesehatan (karyawan)', 50_000],
          ['BPJS JHT (karyawan)', 100_000],
          ['BPJS Jaminan Pensiun (karyawan)', 50_000],
          ['PPh 21', 2_500],
        ],
      );
      expect(w.gross).toBe(5_000_000);
      expect(w.totalDeduction).toBe(202_500);
      expect(w.net).toBe(5_000_000 - 202_500);
    });

    it('deducts nothing statutory for an employee enrolled in neither scheme', async () => {
      const { repo, svc } = build({
        employee: { ...enrolled, bpjsKes: null as never, bpjsTk: null as never },
        summary: { presentDays: 31, lateDays: 0, leaveDays: 0 },
      });
      await svc.generate(user, 'e1', '2026-07');
      // PPh 21 still applies — it is tax, not a scheme — and is HIGHER, because the
      // employee has no BPJS contributions to offset against it.
      const lines = repo.lastWrite!.items.filter((i) => i.kind === 'DEDUCTION');
      expect(lines.map((i) => i.label)).toEqual(['PPh 21']);
      expect(lines[0].amount).toBeGreaterThan(2_500);
    });

    it('withholds no tax when the employee has no PTKP status on file', async () => {
      const { repo, svc } = build({
        employee: { ...enrolled, ptkpStatus: null as never },
        summary: { presentDays: 31, lateDays: 0, leaveDays: 0 },
      });
      await svc.generate(user, 'e1', '2026-07');
      const labels = repo.lastWrite!.items.filter((i) => i.kind === 'DEDUCTION').map((i) => i.label);
      expect(labels).not.toContain('PPh 21');
      expect(labels).toHaveLength(3); // the three BPJS lines still apply
    });

    // The regulated base is gross (base + allowances), not the running total: a lateness
    // deduction does not reduce the wage BPJS is reckoned on.
    it('reckons BPJS on gross, not on gross minus the lateness deduction', async () => {
      const { repo, svc } = build({
        employee: enrolled,
        summary: { presentDays: 31, lateDays: 3, leaveDays: 0 },
      });
      await svc.generate(user, 'e1', '2026-07');
      const health = repo
        .lastWrite!.items.find((i) => i.label === 'BPJS Kesehatan (karyawan)')!;
      expect(health.amount).toBe(50_000); // 1% of 5.000.000, unchanged by the 30.000 late cut
    });
  });

  it('pays overtime above the standard shift as a BONUS line (M24-17)', async () => {
    // 31 July 2026 days, no weekly-off, no holiday → 31 working days.
    // MONTHLY 4,464,000 / (31 × 480) = 300 per minute. 120 overtime minutes × 1.5 = 54,000.
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0 },
      workedMinutes: [{ workDate: '2026-07-06', workingMinutes: 600 }],
    });
    await svc.generate(user, 'e1', '2026-07');
    const line = repo.lastWrite!.items.find((i) => i.label.startsWith('Lembur'));
    expect(line).toMatchObject({ kind: 'BONUS', amount: 54_000 });
    expect(line!.label).toContain('hari kerja 2j');
  });

  it('pays every worked minute on a national holiday, at the off-day rate (M24-17)', async () => {
    // 2026-07-17 is a holiday → all 300 worked minutes are overtime at 2×.
    // 300 × 300/min × 2 = 180,000.
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_320_000 as never },
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0 },
      holidayDates: ['2026-07-17'],
      workedMinutes: [{ workDate: '2026-07-17', workingMinutes: 300 }],
    });
    await svc.generate(user, 'e1', '2026-07');
    const line = repo.lastWrite!.items.find((i) => i.label.startsWith('Lembur'));
    // 30 working days after the holiday is excluded → 4,320,000/(30×480) = 300/min.
    expect(line).toMatchObject({ kind: 'BONUS', amount: 180_000 });
    expect(line!.label).toContain('hari libur 5j');
  });

  it('treats a weekly-off day the same as a holiday (M24-17)', async () => {
    // 2026-07-05 is a Sunday; weeklyOff '0' makes it an off day.
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 96_000 as never },
      summary: { presentDays: 10, lateDays: 0, leaveDays: 0 },
      weeklyOff: '0',
      workedMinutes: [{ workDate: '2026-07-05', workingMinutes: 240 }],
    });
    await svc.generate(user, 'e1', '2026-07');
    // DAILY: 96,000/480 = 200/min. 240 × 200 × 2 = 96,000.
    expect(repo.lastWrite!.items.find((i) => i.label.startsWith('Lembur'))).toMatchObject({
      amount: 96_000,
    });
  });

  it('adds no overtime line when nobody worked past the standard shift (M24-17)', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0 },
      workedMinutes: [{ workDate: '2026-07-06', workingMinutes: 470 }],
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Lembur'))).toBe(false);
  });

  // Depot SOP §1: bonus target penjualan harian, paid in full per attended day.
  describe('daily gallon-target bonus', () => {
    const SOP = '120:15000,150:20000,180:30000,200:50000,225:75000,250:100000,300:150000';
    const daily = { salaryType: 'DAILY' as const, dailyRate: 60_000 as never };
    const attended = [
      { workDate: '2026-07-01', workingMinutes: 480 },
      { workDate: '2026-07-02', workingMinutes: 480 },
      { workDate: '2026-07-03', workingMinutes: 480 },
    ];

    it('pays the reached tier for every attended day and names the day count', async () => {
      const { repo, svc } = build({
        employee: daily,
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0 },
        workedMinutes: attended,
        gallonTiers: SOP,
        dailyGallons: { '2026-07-01': 130, '2026-07-02': 205, '2026-07-03': 100 },
      });
      await svc.generate(user, 'e1', '2026-07');
      const line = repo.lastWrite!.items.find((i) => i.label.startsWith('Bonus target harian'));
      // 130 gal → 15.000; 205 gal → 50.000; 100 gal → below the ladder, nothing.
      expect(line).toMatchObject({ kind: 'BONUS', amount: 65_000 });
      expect(line!.label).toBe('Bonus target harian (2 hari)');
    });

    it('pays nothing for a day the employee did not attend', async () => {
      const { repo, svc } = build({
        employee: daily,
        summary: { presentDays: 1, lateDays: 0, leaveDays: 0 },
        workedMinutes: [{ workDate: '2026-07-01', workingMinutes: 480 }],
        gallonTiers: SOP,
        // The depot hit 300 gallons on the 2nd, but this employee was not there.
        dailyGallons: { '2026-07-01': 120, '2026-07-02': 300 },
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(
        repo.lastWrite!.items.find((i) => i.label.startsWith('Bonus target harian')),
      ).toMatchObject({ amount: 15_000 });
    });

    it('adds no line at all when no attended day reached a tier', async () => {
      const { repo, svc } = build({
        employee: daily,
        summary: { presentDays: 1, lateDays: 0, leaveDays: 0 },
        workedMinutes: [{ workDate: '2026-07-01', workingMinutes: 480 }],
        gallonTiers: SOP,
        dailyGallons: { '2026-07-01': 90 },
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Bonus target harian'))).toBe(
        false,
      );
    });

    it('pays nothing when order-service could not answer — null never pays', async () => {
      const { repo, svc } = build({
        employee: daily,
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0 },
        workedMinutes: attended,
        gallonTiers: SOP,
        dailyGallons: null,
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Bonus target harian'))).toBe(
        false,
      );
    });

    // The regression that matters most: every depot ships with the setting EMPTY, and none
    // of them may see a single rupiah move.
    it('leaves an unconfigured depot byte-identical to the old payroll', async () => {
      const opts = {
        employee: daily,
        summary: { presentDays: 3, lateDays: 1, leaveDays: 0 },
        workedMinutes: attended,
      };
      const before = build(opts);
      await before.svc.generate(user, 'e1', '2026-07');
      const after = build({ ...opts, dailyGallons: { '2026-07-01': 500 } }); // no gallonTiers
      await after.svc.generate(user, 'e1', '2026-07');
      expect(after.repo.lastWrite).toEqual(before.repo.lastWrite);
    });

    it('never calls order-service when no ladder is configured', async () => {
      const depotDailyGallons = jest.fn(async () => new Map<string, number>());
      const { svc } = build({
        employee: daily,
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0 },
        workedMinutes: attended,
        salesPort: { depotSales: async () => null, depotDailyGallons },
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(depotDailyGallons).not.toHaveBeenCalled();
    });

    it('never calls order-service for an employee with no home depot', async () => {
      const depotDailyGallons = jest.fn(async () => new Map<string, number>());
      const { svc } = build({
        employee: { ...daily, depotId: null },
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0 },
        workedMinutes: attended,
        gallonTiers: SOP,
        salesPort: { depotSales: async () => null, depotDailyGallons },
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(depotDailyGallons).not.toHaveBeenCalled();
    });

    it('asks for the month as LOCAL day keys, not instants', async () => {
      const depotDailyGallons = jest.fn(async () => new Map<string, number>());
      const { svc } = build({
        employee: daily,
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0 },
        workedMinutes: attended,
        gallonTiers: SOP,
        salesPort: { depotSales: async () => null, depotDailyGallons },
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(depotDailyGallons).toHaveBeenCalledWith('d1', '2026-07-01', '2026-07-31');
    });
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
    const draft = build({
      employee: { dailyRate: 1000 as never },
      summary: { presentDays: 1, lateDays: 0, leaveDays: 0 },
    });
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
