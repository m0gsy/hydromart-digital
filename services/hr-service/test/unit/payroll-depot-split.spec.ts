import { PayrollService } from '../../src/application/services/payroll.service';
import type { DepotMove } from '../../src/domain/depot-on';

const USER = { sub: 'hr_1', role: 'HR', depotId: null } as never;
const G = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const PERIOD = '2026-09'; // 30 days, closed

type Share = { depotId: string; days: number; gross: number; bonus: number; deduction: number; shortfall: number; net: number };
interface Written {
  gross: number;
  totalBonus: number;
  totalDeduction: number;
  net: number;
  items: { kind: string; label: string; amount: number }[];
  shares?: Share[];
}

/** 16-25 Sep on loan at Pekayon: 20 days home, 10 days away. */
const LOAN: DepotMove[] = [
  { kind: 'LOAN_START', effectiveDate: '2026-09-16', seq: 1, fromDepotId: G, toDepotId: P, loanEndDate: '2026-09-25' },
  { kind: 'LOAN_END', effectiveDate: '2026-09-26', seq: 2, fromDepotId: P, toDepotId: G },
];

interface Opts {
  enabled?: boolean;
  salaryType?: 'MONTHLY' | 'DAILY';
  rate?: number;
  moves?: DepotMove[];
  timelineThrows?: boolean;
  worked?: { workDate: Date; workingMinutes: number; lateMinutes: number; depotId?: string | null }[];
  existing?: boolean;
  tiers?: string;
  gallons?: Record<string, Record<string, number>>;
  bonus?: number;
  deduction?: number;
  presentDays?: number;
  employee?: Record<string, unknown>;
}

function build(o: Opts = {}) {
  const employee = {
    id: 'emp_1',
    depotId: G,
    homeDepotId: G,
    salaryType: o.salaryType ?? 'MONTHLY',
    monthlyRate: (o.salaryType ?? 'MONTHLY') === 'MONTHLY' ? (o.rate ?? 3_000_000) : null,
    dailyRate: o.salaryType === 'DAILY' ? (o.rate ?? 100_000) : null,
    employmentStatus: 'PERMANENT',
    status: 'ACTIVE',
    joinDate: new Date('2020-01-01T00:00:00.000Z'),
    exitDate: null,
    contractEndDate: null,
    role: null,
    ...o.employee,
  };
  const written: { create?: Written; regenerate?: Written } = {};
  const asked: Record<string, (string | null)[]> = { fine: [], tier: [], thr: [], tolerance: [] };
  const sales = {
    depotSales: async () => null,
    depotDailyGallons: jest.fn(async (depot: string) => {
      const m = o.gallons?.[depot];
      return m ? new Map(Object.entries(m)) : new Map<string, number>();
    }),
  };
  const svc = new PayrollService(
    {
      findByEmployeeAndPeriod: async () => (o.existing ? { id: 'pay_1', status: 'DRAFT' } : null),
      create: async (w: Written) => ((written.create = w), { id: 'pay_1', ...w }),
      regenerate: async (_id: string, w: Written) => ((written.regenerate = w), { id: 'pay_1', ...w }),
      list: async () => ({ rows: [], total: 0 }),
    } as never,
    {
      summary: async () => ({ presentDays: o.presentDays ?? 30, lateDays: 0, leaveDays: 0, pendingDays: 0 }),
      listWorkedMinutes: async () => o.worked ?? [],
    } as never,
    { listByEmployeePeriod: async () => (o.bonus ? [{ id: 'b1', type: 'OTHER', amount: o.bonus, note: null }] : []) } as never,
    { listByEmployeePeriod: async () => (o.deduction ? [{ id: 'd1', type: 'OTHER', amount: o.deduction, note: null }] : []) } as never,
    { getById: async () => employee, list: jest.fn(async () => ({ rows: [], total: 0 })) } as never,
    {
      depotAssignmentEnabled: o.enabled ?? true,
      timeZone: 'Asia/Jakarta',
      weeklyOffDays: () => '',
      lateDeductionAmount: () => 0,
      absenceDeductionAmount: () => 0,
      absentAfterMinutes: () => 0,
      dailySalesBonusTiers: (d: string | null) => (asked.tier.push(d), o.tiers ?? ''),
      dailyRateTraining: () => 0,
      lateFineCsv: (_m: boolean, d: string | null) => (asked.fine.push(d), ''),
      lateTier2AfterMinutes: () => 30,
      lateTier: () => '',
      overtimeMultiplierPct: () => 0,
      overtimeOffDayMultiplierPct: () => 0,
      standardWorkingMinutes: () => 480,
      statutoryRates: () => '',
      pph21TerTable: () => ({}),
      tenureRaiseLadder: () => '',
      thrPeriodMonth: (d: string | null) => (asked.thr.push(d), ''),
      lateToleranceMinutes: (d: string | null) => (asked.tolerance.push(d), 15),
      breakMinutes: () => 0,
      overtimeMinMinutes: () => 0,
      overtimeCapMinutes: () => 0,
    } as never,
    undefined,
    undefined,
    undefined,
    o.tiers ? (sales as never) : undefined,
    undefined,
    undefined,
    {
      timelineFor: async () => {
        if (o.timelineThrows) throw new Error('db down');
        return o.moves ?? [];
      },
    } as never,
  );
  return { svc, written, asked, sales };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('flag off: a payslip is written exactly as before', () => {
  it('a new payslip carries no shares at all', async () => {
    const { svc, written } = build({ enabled: false, moves: LOAN });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create).toBeDefined();
    expect('shares' in written.create!).toBe(false);
  });

  it('regenerating a draft that may have been split while the switch was on drops the split', async () => {
    const { svc, written } = build({ enabled: false, existing: true });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.regenerate!.shares).toEqual([]);
  });

  it('the live depot is still what the rules read', async () => {
    const { svc, asked } = build({ enabled: false, employee: { depotId: P, homeDepotId: G } });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(asked.fine).toEqual([P]);
  });
});

describe('flag on', () => {
  it('somebody never lent out has one share: the home depot, everything', async () => {
    const { svc, written } = build();
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create!.shares).toEqual([
      { depotId: G, days: 30, gross: 3_000_000, bonus: 0, deduction: 0, shortfall: 0, net: 3_000_000 },
    ]);
  });

  it('a MONTHLY wage is split by calendar days the ledger puts at each depot (20 : 10)', async () => {
    const { svc, written } = build({ moves: LOAN });
    await svc.generate(USER, 'emp_1', PERIOD);
    const shares = written.create!.shares!;
    expect(shares.map((s) => [s.depotId, s.days, s.gross])).toEqual([
      [G, 20, 2_000_000],
      [P, 10, 1_000_000],
    ]);
    expect(sum(shares.map((s) => s.net))).toBe(written.create!.net);
  });

  it('bonus and deductions follow the same split and always add back exactly', async () => {
    const { svc, written } = build({ moves: LOAN, rate: 3_000_001, bonus: 100_001, deduction: 50_001 });
    await svc.generate(USER, 'emp_1', PERIOD);
    const w = written.create!;
    const s = w.shares!;
    expect(sum(s.map((x) => x.gross))).toBe(w.gross);
    expect(sum(s.map((x) => x.bonus))).toBe(w.totalBonus);
    expect(sum(s.map((x) => x.deduction + x.shortfall))).toBe(w.totalDeduction);
    expect(sum(s.map((x) => x.net))).toBe(w.net);
    for (const x of s) expect(x.net).toBe(x.gross + x.bonus - x.deduction);
  });

  it('every RULE comes from the home depot, even while the live depot is somewhere else', async () => {
    const { svc, asked } = build({ moves: LOAN, employee: { depotId: P, homeDepotId: G } });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(asked.fine.every((d) => d === G)).toBe(true);
    expect(asked.tier.every((d) => d === G)).toBe(true);
    expect(asked.thr.every((d) => d === G)).toBe(true);
    expect(asked.fine.length).toBeGreaterThan(0);
  });

  it('a DAILY wage is split by the days worked at each depot', async () => {
    const day = (n: number) => new Date(`2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`);
    const worked = [
      ...[1, 2, 3].map((n) => ({ workDate: day(n), workingMinutes: 480, lateMinutes: 0, depotId: G })),
      ...[16, 17].map((n) => ({ workDate: day(n), workingMinutes: 480, lateMinutes: 0, depotId: P })),
    ];
    const { svc, written } = build({ salaryType: 'DAILY', rate: 100_000, presentDays: 5, worked });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create!.shares!.map((s) => [s.depotId, s.days, s.gross])).toEqual([
      [G, 3, 300_000],
      [P, 2, 200_000],
    ]);
  });

  it('a day with no depot stamp counts for the home depot', async () => {
    const worked = [{ workDate: new Date('2026-09-02T00:00:00.000Z'), workingMinutes: 480, lateMinutes: 0, depotId: null }];
    const { svc, written } = build({ salaryType: 'DAILY', presentDays: 1, worked });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create!.shares![0]).toMatchObject({ depotId: G, days: 1 });
  });

  it('the daily gallon bonus is earned where the day was worked, judged by that depot gallons', async () => {
    const at = (d: string, depotId: string) => ({
      workDate: new Date(`2026-09-${d}T00:00:00.000Z`),
      workingMinutes: 480,
      lateMinutes: 0,
      depotId,
    });
    // Three days at home, one at Pekayon: weights 3:1, but the bonus must NOT follow them.
    const worked = [at('02', G), at('03', G), at('04', G), at('17', P)];
    const { svc, written, sales } = build({
      salaryType: 'DAILY',
      presentDays: 4,
      worked,
      tiers: '100:20000',
      // Home hit its tier on the 2nd; Pekayon on the 17th (home's gallons that day would NOT).
      gallons: { [G]: { '2026-09-02': 120, '2026-09-17': 10 }, [P]: { '2026-09-17': 150 } },
    });
    await svc.generate(USER, 'emp_1', PERIOD);
    const bonus = written.create!.items.filter((i) => i.label.startsWith('Bonus target harian'));
    expect(bonus).toHaveLength(1);
    expect(bonus[0].amount).toBe(40_000);
    const byDepot = Object.fromEntries(written.create!.shares!.map((s) => [s.depotId, s.bonus]));
    expect(byDepot).toEqual({ [G]: 20_000, [P]: 20_000 });
    expect(sales.depotDailyGallons).toHaveBeenCalledWith(P, '2026-09-01', '2026-09-30');
  });

  it('unknown gallons at another depot invent nothing', async () => {
    const worked = [{ workDate: new Date('2026-09-17T00:00:00.000Z'), workingMinutes: 480, lateMinutes: 0, depotId: P }];
    const { svc, written, sales } = build({ salaryType: 'DAILY', presentDays: 1, worked, tiers: '100:20000', gallons: { [G]: {} } });
    sales.depotDailyGallons.mockImplementation(async (d: string) => (d === P ? (null as never) : new Map()));
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create!.items.some((i) => i.label.startsWith('Bonus target'))).toBe(false);
  });

  it('regenerating replaces the split', async () => {
    const { svc, written } = build({ moves: LOAN, existing: true });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.regenerate!.shares).toHaveLength(2);
  });

  it('a split that cannot be computed never blocks the payslip: the home depot carries it', async () => {
    const { svc, written } = build({ moves: LOAN, timelineThrows: true });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create!.shares).toEqual([
      { depotId: G, days: 0, gross: 3_000_000, bonus: 0, deduction: 0, shortfall: 0, net: 3_000_000 },
    ]);
  });

  it('an employee with no depot at all gets no split', async () => {
    const { svc, written } = build({ employee: { depotId: null, homeDepotId: null } });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create!.shares).toEqual([]);
  });

  it('the employment window clips the weights (left on the 20th)', async () => {
    const { svc, written } = build({ moves: LOAN, employee: { exitDate: new Date('2026-09-20T00:00:00.000Z') } });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(written.create!.shares!.map((s) => [s.depotId, s.days])).toEqual([
      [G, 15],
      [P, 5],
    ]);
  });
});

describe('the payroll batch', () => {
  it('lists a depot by the people who BELONG to it once the feature is on, not before', async () => {
    const on = build();
    await on.svc.generateBatch(USER, G, PERIOD);
    const onCall = (on.svc as unknown as { employees: { list: jest.Mock } }).employees.list.mock.calls[0];
    expect(onCall[1]).toMatchObject({ depotId: G, byHome: true });

    const off = build({ enabled: false });
    await off.svc.generateBatch(USER, G, PERIOD);
    const offCall = (off.svc as unknown as { employees: { list: jest.Mock } }).employees.list.mock.calls[0];
    expect(offCall[1].byHome).toBe(false);
  });
});
