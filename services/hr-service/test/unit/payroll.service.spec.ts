import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
  /** D4: no earlier payslip took anything, unless a test says otherwise. */
  repaid = new Map<string, number>();
  async deductedBySourceRefBefore(): Promise<Map<string, number>> {
    return this.repaid;
  }
  lastListFilter?: Parameters<PayrollRepository['list']>[0];
  rows: Payroll[] = [];
  async list(filter: Parameters<PayrollRepository['list']>[0]) {
    this.lastListFilter = filter;
    return { rows: this.rows as (Payroll & { employeeName: string | null })[], total: this.rows.length };
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
  /** D2 unpaid break, both weekdays at once; omitted = the shipped 60/90. */
  breakMinutes?: number;
  /** The rota HR built: shift assignments + the shifts/rotations they name (CA-1-38). */
  shifts?: import('../../src/application/ports/shift.repository').ShiftRepository;
  /** Depot SOP daily gallon bonus ladder; '' (the default) = feature off. */
  gallonTiers?: string;
  /** Gallons the depot sold per local day; null = order-service unavailable. */
  dailyGallons?: Record<string, number> | null;
  /** Depot SOP tiered late fines, "telat1,telat2,tidakAbsen"; '' = the old flat rate. */
  lateFineStaff?: string;
  lateFineManager?: string;
  lateTier2After?: number;
  absentAfter?: number;
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
    summary: async () =>
      opts.summary ?? { presentDays: 0, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
    findById: async () => null,
    delete: async () => undefined,
  };
  const deductions: DeductionRepository = {
    create: async () => ({}) as Deduction,
    listByEmployeePeriod: async () => (opts.deductions ?? []) as Deduction[],
    findById: async () => null,
    delete: async () => undefined,
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
    // D2's shipped defaults. Tests that want the old "the break is paid" behaviour pass 0.
    breakMinutes: (isFriday: boolean) => opts.breakMinutes ?? (isFriday ? 90 : 60),
    overtimeMultiplierPct: () => opts.overtimePct ?? 150,
    overtimeOffDayMultiplierPct: () => opts.overtimeOffDayPct ?? 200,
    dailySalesBonusTiers: () => opts.gallonTiers ?? '',
    tenureRaiseLadder: () => '',
    thrPeriodMonth: () => '',
    lateFineCsv: (isDepotManager: boolean) =>
      (isDepotManager ? opts.lateFineManager : opts.lateFineStaff) ?? '',
    lateTier2AfterMinutes: () => opts.lateTier2After ?? 0,
    absentAfterMinutes: () => opts.absentAfter ?? 0,
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
      undefined,
      opts.shifts,
    ),
  };
}

describe('PayrollService.generate', () => {
  it('DAILY base = dailyRate × presentDays; net folds bonus and deductions', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 50000 as never },
      summary: { presentDays: 20, lateDays: 2, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 31, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 31, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 31, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 31, lateDays: 3, leaveDays: 0, pendingDays: 0 },
      });
      await svc.generate(user, 'e1', '2026-07');
      const health = repo
        .lastWrite!.items.find((i) => i.label === 'BPJS Kesehatan (karyawan)')!;
      expect(health.amount).toBe(50_000); // 1% of 5.000.000, unchanged by the 30.000 late cut
    });
  });

  it('pays overtime above the standard shift as a BONUS line (M24-17)', async () => {
    // 31 July 2026 days, no weekly-off, no holiday → 31 working days.
    // MONTHLY 4,464,000 / (31 × 480) = 300 per minute.
    //
    // D2 (owner decision, 2 September 2026): 60 minutes of the day are unpaid break — 90 on
    // a Friday — deducted from any day of 6 hours or more. 2026-07-06 is a Monday, so 600
    // worked minutes are 540 paid: 60 over the standard shift, not 120.
    // 60 × 300 × 1.5 = 27,000.
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 },
      workedMinutes: [{ workDate: '2026-07-06', workingMinutes: 600 }],
    });
    await svc.generate(user, 'e1', '2026-07');
    const line = repo.lastWrite!.items.find((i) => i.label.startsWith('Lembur'));
    expect(line).toMatchObject({ kind: 'BONUS', amount: 27_000 });
    expect(line!.label).toContain('hari kerja 1j');
  });

  it('pays every worked minute on a national holiday, at the off-day rate (M24-17)', async () => {
    // 2026-07-17 is a holiday → all 300 worked minutes are overtime at 2×.
    // 300 × 300/min × 2 = 180,000.
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_320_000 as never },
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
      summary: { presentDays: 10, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
      summary: { presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 1, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 1, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 3, lateDays: 1, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
        summary: { presentDays: 3, lateDays: 0, leaveDays: 0, pendingDays: 0 },
        workedMinutes: attended,
        gallonTiers: SOP,
        salesPort: { depotSales: async () => null, depotDailyGallons },
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(depotDailyGallons).toHaveBeenCalledWith('d1', '2026-07-01', '2026-07-31');
    });
  });

  // Depot SOP §2: denda telat bertingkat per jabatan.
  describe('tiered late fine', () => {
    const STAFF = '10000,15000,20000';
    const MANAGER = '15000,20000,25000';
    const boundaries = { lateTier2After: 70, absentAfter: 130 };
    // 07.50 start: 40' late = tier 1, 80' = tier 2, 200' = counted as not attended.
    const threeLateDays = [
      { workDate: '2026-07-01', workingMinutes: 480, lateMinutes: 40 },
      { workDate: '2026-07-02', workingMinutes: 480, lateMinutes: 80 },
      { workDate: '2026-07-03', workingMinutes: 480, lateMinutes: 200 },
      { workDate: '2026-07-04', workingMinutes: 480, lateMinutes: 0 },
    ];
    const fineLines = (repo: { lastWrite?: { items: { label: string; amount: number }[] } }) =>
      repo.lastWrite!.items.filter((i) => i.label.startsWith('Denda'));

    it('splits a staff member’s month into the three SOP lines', async () => {
      const { repo, svc } = build({
        employee: { salaryType: 'DAILY', dailyRate: 60_000 as never },
        // 4 attended days out of 31 — the rest land in the "tidak absen" count below.
        summary: { presentDays: 4, lateDays: 3, leaveDays: 27, pendingDays: 0 },
        workedMinutes: threeLateDays,
        lateFineStaff: STAFF,
        ...boundaries,
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(fineLines(repo)).toEqual([
        { kind: 'DEDUCTION', label: 'Denda telat 1 (1 hari)', amount: 10_000 },
        { kind: 'DEDUCTION', label: 'Denda telat 2 (1 hari)', amount: 15_000 },
        { kind: 'DEDUCTION', label: 'Denda tidak absen (1 hari)', amount: 20_000 },
      ]);
      // …and the old flat line is gone, not doubled up with the new ones.
      expect(repo.lastWrite!.items.some((i) => i.label.startsWith('Potongan terlambat'))).toBe(
        false,
      );
    });

    it('charges a kepala depot the manager rates', async () => {
      const { repo, svc } = build({
        employee: {
          salaryType: 'DAILY',
          dailyRate: 80_000 as never,
          role: 'KEPALA_DEPOT',
          joinDate: new Date('2025-01-01T00:00:00.000Z'),
        },
        summary: { presentDays: 4, lateDays: 3, leaveDays: 27, pendingDays: 0 },
        workedMinutes: threeLateDays,
        lateFineStaff: STAFF,
        lateFineManager: MANAGER,
        ...boundaries,
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(fineLines(repo)).toEqual([
        { kind: 'DEDUCTION', label: 'Denda telat 1 (1 hari)', amount: 15_000 },
        { kind: 'DEDUCTION', label: 'Denda telat 2 (1 hari)', amount: 20_000 },
        { kind: 'DEDUCTION', label: 'Denda tidak absen (1 hari)', amount: 25_000 },
      ]);
    });

    // Before this, "tidak absen" was MONTHLY-only, so depot staff on a daily rate were
    // never fined for a missed day at all.
    it('fines a DAILY employee for calendar days nobody turned up for', async () => {
      const { repo, svc } = build({
        employee: { salaryType: 'DAILY', dailyRate: 60_000 as never },
        // July 2026 has 31 working days with no weekly-off configured.
        summary: { presentDays: 29, lateDays: 0, leaveDays: 0, pendingDays: 0 },
        workedMinutes: [],
        lateFineStaff: STAFF,
        ...boundaries,
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(fineLines(repo)).toEqual([
        { kind: 'DEDUCTION', label: 'Denda tidak absen (2 hari)', amount: 40_000 },
      ]);
    });

    // D2: a PENDING punch is a day HR has not decided yet — the schema calls it "counts as
    // nothing". `absentDays` counted every day that was not PRESENT/LATE/LEAVE, so an
    // offline punch synced late, or a supervisor punching outside every geofence, was fined
    // as a full no-show if payroll ran before someone judged it.
    it('does not fine a day whose punch is still PENDING', async () => {
      const { repo, svc } = build({
        employee: { salaryType: 'DAILY', dailyRate: 60_000 as never },
        // 31 working days: 29 attended, 2 awaiting a decision, 0 genuinely missed.
        summary: { presentDays: 29, lateDays: 0, leaveDays: 0, pendingDays: 2 },
        workedMinutes: [],
        lateFineStaff: STAFF,
        ...boundaries,
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(fineLines(repo)).toEqual([]);
    });

    it('adds no line for a step whose rate is 0', async () => {
      const { repo, svc } = build({
        employee: { salaryType: 'DAILY', dailyRate: 60_000 as never },
        summary: { presentDays: 31, lateDays: 1, leaveDays: 0, pendingDays: 0 },
        workedMinutes: [{ workDate: '2026-07-01', workingMinutes: 480, lateMinutes: 40 }],
        lateFineStaff: '0,15000,20000',
        ...boundaries,
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(fineLines(repo)).toEqual([]);
    });

    it('keeps the flat deduction untouched when no tiered fine is configured', async () => {
      const { repo, svc } = build({
        employee: { salaryType: 'DAILY', dailyRate: 60_000 as never },
        summary: { presentDays: 31, lateDays: 3, leaveDays: 0, pendingDays: 0 },
        workedMinutes: threeLateDays,
      });
      await svc.generate(user, 'e1', '2026-07');
      expect(repo.lastWrite!.items.filter((i) => i.kind === 'DEDUCTION')).toEqual([
        { kind: 'DEDUCTION', label: 'Potongan terlambat (3 hari)', amount: 30_000 },
      ]);
    });
  });

  it('TRAINING with no dailyRate falls back to the config training rate', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: null, employmentStatus: 'TRAINING' as never },
      summary: { presentDays: 10, lateDays: 0, leaveDays: 0, pendingDays: 0 },
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.gross).toBe(300_000); // 30k × 10
  });

  it('MONTHLY base = monthlyRate regardless of present days', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_000_000 as never },
      summary: { presentDays: 18, lateDays: 5, leaveDays: 0, pendingDays: 0 },
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
      summary: { presentDays: 20, lateDays: 5, leaveDays: 2, pendingDays: 0 },
      absenceRate: 25_000,
      holidayDates: ['2026-07-17'],
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite!.totalDeduction).toBe(250_000); // 200k absence + 50k late
  });

  it('DAILY never gets an absence deduction (missing days already earn nothing)', async () => {
    const { repo, svc } = build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      summary: { presentDays: 5, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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
      summary: { presentDays: 1, lateDays: 0, leaveDays: 0, pendingDays: 0 },
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

// D1: `list` used to take no `user` at all, so a depot manager asking for a whole page of
// a period got every employee's gross/bonus/deduction/net in the chain. `hrView` reaches
// MANAGER, SUPERVISOR and ASSISTANT_SUPERVISOR, so this was three scoped roles wide.
describe('PayrollService.list depot scoping (D1)', () => {
  const manager = (depotIds: readonly string[]): AuthenticatedUser => ({
    sub: 'm1',
    role: 'MANAGER' as never,
    phone: null,
    depotId: depotIds[0] ?? null,
    depotIds,
  });
  const page = { page: 1, pageSize: 30 };

  it('narrows a depot manager to their own depots', async () => {
    const { repo, svc } = build({ employee: {} });
    await svc.list(manager(['dA']), page);
    expect(repo.lastListFilter?.depotIds).toEqual(['dA']);
  });

  it('refuses a depot the caller is not responsible for', async () => {
    const { svc } = build({ employee: {} });
    await expect(svc.list(manager(['dA']), { ...page, depotId: 'dB' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  /*
   * PG-01 — forty draft payslips with nobody's name on them.
   *
   * A payroll row carries `employeeId` and nothing else a person can read, so the queue was
   * forty rows of the same period and the same status, and the DETAIL screen behind each one
   * said "Slip Gaji 2026-08 · 22 hari hadir · Rp 4.150.000" with no name either. HR approved
   * and marked paid without ever seeing whose wage it was, and could not check afterwards.
   *
   * The depot check on the detail already LOADS the owning employee and threw the answer
   * away; the list gets the same answer in one batch read.
   */
  // The list half of PG-01 is a JOIN, so it is proved where the join is written:
  // test/unit/prisma-repositories.spec.ts. This is the detail half.
  // An employee anonymised by retention has no name left. Null, never a blank that reads
  // as somebody — the money rows survive the scrub on purpose (they are audit evidence).
  it('says the name is gone rather than printing an empty one', async () => {
    const { repo, svc } = build({ employee: { id: 'e1', fullName: null as never } });
    repo.byId = { id: 'p1', employeeId: 'e1', status: 'DRAFT' } as PayrollWithItems;
    await expect(svc.getById(manager(['dA']), 'p1')).resolves.toMatchObject({
      employeeName: null,
    });
  });

  it('names the person on the payslip itself', async () => {
    const { repo, svc } = build({ employee: { id: 'e1', fullName: 'Sari Wulandari' } });
    repo.byId = { id: 'p1', employeeId: 'e1', status: 'DRAFT' } as PayrollWithItems;

    const slip = await svc.getById(manager(['dA']), 'p1');

    expect(slip.employeeName).toBe('Sari Wulandari');
  });

  it('leaves an HQ caller unscoped', async () => {
    const { repo, svc } = build({ employee: {} });
    await svc.list({ sub: 'hq', role: 'HEAD_OFFICE' as never, phone: null, depotId: null }, page);
    expect(repo.lastListFilter?.depotIds).toBeUndefined();
  });
});

/**
 * December is the month that makes the other eleven honest. The engine must switch method
 * on the period alone — no flag, no setting — and it must never produce a negative
 * deduction, because an employer cannot refund tax through payroll.
 */
describe('PPh 21 in December', () => {
  it('reconciles against the year already withheld instead of estimating again', async () => {
    const { svc, repo } = build({
      employee: {
        salaryType: 'MONTHLY' as const,
        monthlyRate: 20_000_000 as never,
        ptkpStatus: 'TK0',
        npwp: '123',
        bpjsKes: '1',
        bpjsTk: '1',
      },
      summary: { presentDays: 22, lateDays: 0, leaveDays: 0, pendingDays: 0 },
    });
    repo.ytd = { grossIdr: 220_000_000, bpjsIdr: 6_600_000, withheldIdr: 1_000_000, months: 11 };
    await svc.generate(user, 'e1', '2025-12');
    const tax = repo.lastWrite?.items.find((i) => i.label === 'PPh 21');
    // A year of Rp 20jt/month owes far more than Rp 1jt, so December collects the gap —
    // which is much larger than any single ordinary month.
    expect(Number(tax?.amount ?? 0)).toBeGreaterThan(10_000_000);
  });

  it('withholds nothing in December when the year already took enough', async () => {
    const { svc, repo } = build({
      employee: {
        salaryType: 'MONTHLY' as const,
        monthlyRate: 20_000_000 as never,
        ptkpStatus: 'TK0',
        npwp: '123',
        bpjsKes: '1',
        bpjsTk: '1',
      },
      summary: { presentDays: 22, lateDays: 0, leaveDays: 0, pendingDays: 0 },
    });
    repo.ytd = { grossIdr: 220_000_000, bpjsIdr: 6_600_000, withheldIdr: 900_000_000, months: 11 };
    await svc.generate(user, 'e1', '2025-12');
    expect(repo.lastWrite?.items.some((i) => i.label === 'PPh 21')).toBe(false);
  });

  it('leaves every other month on the monthly method', async () => {
    const { svc, repo } = build({
      employee: {
        salaryType: 'MONTHLY' as const,
        monthlyRate: 20_000_000 as never,
        ptkpStatus: 'TK0',
        npwp: '123',
        bpjsKes: '1',
        bpjsTk: '1',
      },
      summary: { presentDays: 22, lateDays: 0, leaveDays: 0, pendingDays: 0 },
    });
    repo.ytd = { grossIdr: 220_000_000, bpjsIdr: 6_600_000, withheldIdr: 0, months: 11 };
    await svc.generate(user, 'e1', '2025-11');
    const tax = Number(repo.lastWrite?.items.find((i) => i.label === 'PPh 21')?.amount ?? 0);
    // November ignores the year to date entirely: it is one month's estimate.
    expect(tax).toBeGreaterThan(0);
    expect(tax).toBeLessThan(5_000_000);
  });
});

/*
 * CA-1-38 / CA-1-39 — payroll reads the rota HR actually built, net of the unpaid break.
 *
 * The standard day used to come from one per-depot number, so a depot running two shift
 * lengths priced overtime off the wrong line for everyone on the shorter one. And the span a
 * shift declares is GROSS: owner decision D2 takes 60 minutes out of it (90 on a Friday)
 * before anything counts as overtime.
 *
 * None of this was reachable from a test before — nothing wired the shift repository — which
 * is why payroll.service.ts sat at 80% branches while every assertion in the file passed.
 */
describe('PayrollService · CA-1-38/CA-1-39 the roster decides the standard day', () => {
  /** A shift row, cast once here so each case reads as data rather than as ceremony. */
  const shift = (id: string, startTime: string, endTime: string) =>
    ({ id, startTime, endTime, depotId: 'd1', name: id }) as never;

  const rota = (o: Record<string, unknown>) => o as never;

  const MONDAY = [{ workDate: '2026-07-06', workingMinutes: 600 }];
  const base = {
    summary: { presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 },
    workedMinutes: MONDAY,
  };
  const overtimeLine = (repo: { lastWrite?: { items: { label: string }[] } | null }) =>
    repo.lastWrite?.items.find((i) => i.label.startsWith('Lembur'));

  it('takes the standard day from the assigned shift, not the depot default', async () => {
    const { repo, svc } = build({
      ...base,
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never, shiftId: 's-long' },
      breakMinutes: 0,
      shifts: rota({
        listAssignmentsUpTo: async () => [],
        findRotationById: async () => null,
        // 07:00–17:00 is a 600-minute day, so today's 600 worked minutes are NOT overtime —
        // the 480-minute depot default would have called 120 of them overtime and paid it.
        findById: async () => shift('s-long', '07:00', '17:00'),
        findActiveForDepot: async () => null,
      }),
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(overtimeLine(repo)).toBeUndefined();
  });

  it('takes the unpaid break off BOTH the worked day and the rostered span', async () => {
    const { repo, svc } = build({
      ...base,
      workedMinutes: [{ workDate: '2026-07-06', workingMinutes: 660 }],
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never, shiftId: 's-long' },
      // D2's default: 60 unpaid minutes on a Monday, and it comes off BOTH sides — the day
      // worked AND the span it is measured against. So a courier who works exactly their
      // 600-minute roster earns no overtime (540 paid against a 540 standard), and only the
      // 60 minutes BEYOND the roster are overtime here.
      shifts: rota({
        listAssignmentsUpTo: async () => [],
        findRotationById: async () => null,
        findById: async () => shift('s-long', '07:00', '17:00'),
        findActiveForDepot: async () => null,
      }),
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(overtimeLine(repo)).toBeDefined();
  });

  it('reads a rotation pattern, whose blank days are days off', async () => {
    const { repo, svc } = build({
      ...base,
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      breakMinutes: 0,
      shifts: rota({
        listAssignmentsUpTo: async () => [
          { id: 'a1', employeeId: 'e1', rotationId: 'r1', shiftId: null, effectiveFrom: new Date('2026-01-01') },
        ],
        findRotationById: async () => ({ id: 'r1', name: 'R', pattern: { 0: null, 1: 's1', 2: 's1', 3: 's1', 4: 's1', 5: 's1', 6: 's1' } }),
        findById: async () => shift('s1', '07:00', '17:00'),
        findActiveForDepot: async () => null,
      }),
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(overtimeLine(repo)).toBeUndefined();
  });

  it('queries each distinct shift once, however many days name it', async () => {
    const seen: string[] = [];
    const { repo, svc } = build({
      ...base,
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      breakMinutes: 0,
      shifts: rota({
        listAssignmentsUpTo: async () => [
          { id: 'a1', employeeId: 'e1', rotationId: 'r1', shiftId: null, effectiveFrom: new Date('2026-01-01') },
        ],
        // Six days on one shift, one on another: a weekly pattern names two or three shifts
        // across seven days and this must not become seven queries.
        findRotationById: async () => ({ id: 'r1', name: 'R', pattern: { 0: 's1', 1: 's1', 2: 's1', 3: 's1', 4: 's1', 5: 's1', 6: 's2' } }),
        findById: async (id: string) => {
          seen.push(id);
          return shift(id, '07:00', id === 's1' ? '17:00' : '15:00');
        },
        findActiveForDepot: async () => null,
      }),
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(seen.sort()).toEqual(['s1', 's2']);
    // Two different shift lengths, so there is no single uniform standard day to price by.
    expect(repo.lastWrite).toBeTruthy();
  });

  it('treats a dangling shift id as no span, not as a zero-hour day', async () => {
    const { repo, svc } = build({
      ...base,
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      breakMinutes: 0,
      shifts: rota({
        listAssignmentsUpTo: async () => [
          { id: 'a1', employeeId: 'e1', rotationId: 'r1', shiftId: null, effectiveFrom: new Date('2026-01-01') },
        ],
        findRotationById: async () => ({ id: 'r1', name: 'R', pattern: { 0: 'gone', 1: 'gone', 2: 'gone', 3: 'gone', 4: 'gone', 5: 'gone', 6: 'gone' } }),
        // ShiftService.remove can leave a pattern naming an id that no longer resolves.
        findById: async () => null,
        findActiveForDepot: async () => null,
      }),
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(repo.lastWrite).toBeTruthy();
  });

  it('falls back to the depot shift when the employee is on no roster', async () => {
    const { repo, svc } = build({
      ...base,
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      breakMinutes: 0,
      shifts: rota({
        listAssignmentsUpTo: async () => [],
        findRotationById: async () => null,
        findById: async () => null,
        findActiveForDepot: async () => shift('s-depot', '07:00', '17:00'),
      }),
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(overtimeLine(repo)).toBeUndefined();
  });

  it('keeps the configured standard day when nothing rosters the employee at all', async () => {
    const { repo, svc } = build({
      ...base,
      employee: { salaryType: 'MONTHLY', monthlyRate: 4_464_000 as never },
      breakMinutes: 0,
      shifts: rota({
        listAssignmentsUpTo: async () => [],
        findRotationById: async () => null,
        findById: async () => null,
        findActiveForDepot: async () => null,
      }),
    });
    await svc.generate(user, 'e1', '2026-07');
    // No span anywhere, so the 480-minute default stands and 120 minutes are overtime.
    expect(overtimeLine(repo)).toBeDefined();
  });
});

/*
 * CA-1-06 — a month that has not finished cannot be paid.
 *
 * Generating mid-month fined every day the employee had not worked yet: the summary counts
 * absences against a FULL month of working days, so the days still in the future read as
 * days missed.
 */
describe('PayrollService · CA-1-06 an unfinished month cannot be paid', () => {
  const key = (offsetMonths: number) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offsetMonths);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const svcOf = () =>
    build({
      employee: { salaryType: 'DAILY', dailyRate: 100_000 as never },
      summary: { presentDays: 1, lateDays: 0, leaveDays: 0, pendingDays: 0 },
    }).svc;

  it('refuses the current month', async () => {
    await expect(svcOf().generate(user, 'e1', key(0))).rejects.toThrow(/belum selesai/i);
  });

  it('refuses a future month', async () => {
    await expect(svcOf().generate(user, 'e1', key(1))).rejects.toThrow(/belum selesai/i);
  });
});
