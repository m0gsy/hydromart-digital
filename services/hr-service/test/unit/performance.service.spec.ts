import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, PerformanceReview } from '../../prisma/generated/client';
import { PerformanceService } from '../../src/application/services/performance.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { HolidayRepository } from '../../src/application/ports/holiday.repository';
import {
  PerformanceRepository,
  PerformanceWrite,
} from '../../src/application/ports/performance.repository';
import { SalesPort } from '../../src/application/ports/sales.port';
import { HrConfigService } from '../../src/config/hr-config.service';

const user: AuthenticatedUser = {
  sub: 'reviewer-1',
  role: 'HR' as never,
  phone: null,
  depotId: null,
};

const EMPLOYEE = {
  id: 'e1',
  employeeCode: 'EMP-001',
  fullName: 'Budi',
  depotId: 'd1',
  position: 'Kurir',
} as unknown as Employee;

interface Opts {
  presentDays?: number;
  lateDays?: number;
  /** Null = no SalesPort bound at all; a number/`null` return models the fail-soft path. */
  sales?: number | null;
  salesThrows?: boolean;
  noSalesPort?: boolean;
  noHolidays?: boolean;
  salesTarget?: number;
  weights?: { attendance: number; discipline: number; sales: number };
  roster?: Employee[];
}

function build(opts: Opts = {}) {
  let lastWrite: PerformanceWrite | undefined;
  const repo: PerformanceRepository = {
    upsert: async (data) => {
      lastWrite = data;
      return { id: 'r1', ...data } as unknown as PerformanceReview;
    },
    listByEmployee: async () => [{ id: 'r1' } as PerformanceReview],
    findById: async () => null,
  };
  const getById = jest.fn(async () => EMPLOYEE);
  const employees = { getById } as unknown as EmployeeService;
  const oneSummary = () => ({
    presentDays: opts.presentDays ?? 20,
    lateDays: opts.lateDays ?? 2,
    leaveDays: 0,
  });
  const attendance = {
    summary: jest.fn(async () => oneSummary()),
    // Models the real repository: ONE call for the whole roster, keyed by employee id.
    summaryMany: jest.fn(
      async (ids: string[]) => new Map(ids.map((id) => [id, oneSummary()])),
    ),
  } as unknown as AttendanceRepository;
  const employeesRepo = {
    list: jest.fn(async () => ({
      rows: opts.roster ?? [EMPLOYEE],
      total: (opts.roster ?? [EMPLOYEE]).length,
    })),
  } as unknown as EmployeeRepository;
  const config = {
    // July 2026: 31 days, no weekly off configured, one holiday injected below.
    weeklyOffDays: () => '',
    performanceWeights: () => opts.weights ?? { attendance: 40, discipline: 30, sales: 30 },
    performanceSalesTarget: () => opts.salesTarget ?? 0,
  } as unknown as HrConfigService;
  const holidays = opts.noHolidays
    ? undefined
    : ({ listDates: jest.fn(async () => ['2026-07-17']) } as unknown as HolidayRepository);
  const sales: SalesPort | undefined = opts.noSalesPort
    ? undefined
    : {
        depotSales: jest.fn(async () => {
          if (opts.salesThrows) throw new Error('order-service down');
          return opts.sales ?? null;
        }),
      };

  return {
    getById,
    attendance,
    holidays,
    sales,
    write: () => lastWrite,
    svc: new PerformanceService(
      repo,
      employees,
      attendance,
      employeesRepo,
      config,
      holidays,
      sales,
    ),
  };
}

describe('PerformanceService — manual review', () => {
  it('upserts with the reviewer stamped and defaults for optional fields', async () => {
    const { svc, getById, write } = build();
    await svc.upsert(user, { employeeId: 'e1', periodMonth: '2026-07', score: 88 });
    expect(getById).toHaveBeenCalledWith(user, 'e1'); // 404 + depot check
    expect(write()).toEqual({
      employeeId: 'e1',
      periodMonth: '2026-07',
      score: 88,
      metrics: {},
      reviewerId: 'reviewer-1',
      note: null,
    });
  });

  it('passes through metrics, note and the manager’s own words when given', async () => {
    const { svc, write } = build();
    await svc.upsert(user, {
      employeeId: 'e1',
      periodMonth: '2026-07',
      score: 90,
      metrics: { punctuality: 9 },
      note: 'solid',
      managerNote: 'naik jabatan?',
    });
    expect(write()?.metrics).toEqual({ punctuality: 9 });
    expect(write()?.note).toBe('solid');
    expect(write()?.managerNote).toBe('naik jabatan?');
  });

  it('list checks the employee first, then returns reviews', async () => {
    const { svc, getById } = build();
    const rows = await svc.listByEmployee(user, 'e1');
    expect(getById).toHaveBeenCalledWith(user, 'e1');
    expect(rows).toHaveLength(1);
  });
});

describe('PerformanceService — computed score (C2)', () => {
  it('scores against the working days left after holidays, without saving anything', async () => {
    const { svc, write, attendance } = build({ presentDays: 15, lateDays: 3 });
    const out = await svc.score(user, 'e1', '2026-07');
    // 31 days in July minus the one holiday = 30 scheduled working days.
    expect(out.inputs.workingDays).toBe(30);
    expect(out.score.attendance).toBe(50);
    expect(out.score.discipline).toBe(80);
    // No sales target configured, so sales drops out and only 40/30 are renormalised.
    expect(out.score.sales).toBeNull();
    expect(out.score.final).toBeCloseTo(62.86, 2);
    expect(write()).toBeUndefined();
    expect(attendance.summary).toHaveBeenCalledWith(
      'e1',
      new Date(Date.UTC(2026, 6, 1)),
      new Date(Date.UTC(2026, 6, 31)),
    );
  });

  it('includes sales once a target exists', async () => {
    const { svc } = build({
      presentDays: 30,
      lateDays: 0,
      sales: 50_000_000,
      salesTarget: 100_000_000,
    });
    const out = await svc.score(user, 'e1', '2026-07');
    expect(out.score.sales).toBe(50);
    // (100*40 + 100*30 + 50*30) / 100
    expect(out.score.final).toBe(85);
  });

  it('drops sales rather than scoring zero when order-service cannot be reached', async () => {
    const down = build({
      presentDays: 30,
      lateDays: 0,
      salesThrows: true,
      salesTarget: 100_000_000,
    });
    const out = await down.svc.score(user, 'e1', '2026-07');
    expect(out.inputs.salesTotal).toBeNull();
    expect(out.score.sales).toBeNull();
    // A dead dependency must not make a perfect month look like 70.
    expect(out.score.final).toBe(100);

    const unbound = build({ presentDays: 30, lateDays: 0, noSalesPort: true, salesTarget: 1 });
    expect((await unbound.svc.score(user, 'e1', '2026-07')).score.sales).toBeNull();
  });

  it('counts every calendar day as working when no holiday repository is bound', async () => {
    const { svc } = build({ presentDays: 31, lateDays: 0, noHolidays: true });
    const out = await svc.score(user, 'e1', '2026-07');
    expect(out.inputs.workingDays).toBe(31);
    expect(out.score.attendance).toBe(100);
  });

  it('generate saves the components and the frozen inputs alongside the final score', async () => {
    const { svc, write } = build({ presentDays: 15, lateDays: 3 });
    await svc.generate(user, 'e1', '2026-07', 'perlu pendampingan');
    expect(write()).toMatchObject({
      employeeId: 'e1',
      periodMonth: '2026-07',
      attendanceScore: 50,
      disciplineScore: 80,
      salesScore: null,
      reviewerId: 'reviewer-1',
      managerNote: 'perlu pendampingan',
    });
    expect(write()?.metrics).toMatchObject({
      presentDays: 15,
      lateDays: 3,
      workingDays: 30,
      effectiveWeights: { attendance: 40, discipline: 30, sales: 0 },
    });
  });

  it('omits managerNote entirely when the caller did not send one', async () => {
    const { svc, write } = build();
    await svc.generate(user, 'e1', '2026-07');
    // Omitted, not null — the repository leaves a manager's existing words alone.
    expect(write() && 'managerNote' in write()!).toBe(false);
  });

  it('stores 0 when nothing at all could be measured', async () => {
    const { svc, write } = build({
      presentDays: 0,
      lateDays: 0,
      weights: { attendance: 0, discipline: 0, sales: 0 },
    });
    await svc.generate(user, 'e1', '2026-07');
    expect(write()?.score).toBe(0);
    expect(write()?.attendanceScore).toBe(0);
    expect(write()?.disciplineScore).toBeNull();
  });

  it('costs the same whether the dashboard scores 2 staff or 40 (audit S-6)', async () => {
    // The old shape was one attendance summary (three counts), one holiday read and one
    // sales call PER EMPLOYEE. This pins the new one: a single grouped attendance query,
    // and holidays/sales resolved once per depot no matter how many people are in it.
    const roster = Array.from({ length: 40 }, (_, i) => ({
      ...EMPLOYEE,
      id: `e${i}`,
      employeeCode: `EMP-${i}`,
    })) as Employee[];
    const { svc, attendance, holidays, sales } = build({ roster, sales: 5_000_000 });

    const rows = await svc.dashboard(user, '2026-07', 'd1');

    expect(rows).toHaveLength(40);
    expect(attendance.summaryMany).toHaveBeenCalledTimes(1);
    expect(attendance.summary).not.toHaveBeenCalled();
    expect(holidays?.listDates).toHaveBeenCalledTimes(1);
    expect(sales?.depotSales).toHaveBeenCalledTimes(1);
  });

  it('resolves holidays and sales once per depot, not once per roster', async () => {
    const roster = [
      { ...EMPLOYEE, id: 'a1', depotId: 'd1' },
      { ...EMPLOYEE, id: 'a2', depotId: 'd1' },
      { ...EMPLOYEE, id: 'b1', depotId: 'd2' },
      { ...EMPLOYEE, id: 'b2', depotId: 'd2' },
    ] as Employee[];
    const { svc, holidays, sales } = build({ roster, sales: 1_000 });

    await svc.dashboard(user, '2026-07');

    expect(holidays?.listDates).toHaveBeenCalledTimes(2);
    expect(sales?.depotSales).toHaveBeenCalledTimes(2);
  });

  it('scores an employee with no attendance row in the period as zero days', async () => {
    const { svc, attendance } = build({ roster: [EMPLOYEE] });
    (attendance.summaryMany as jest.Mock).mockResolvedValueOnce(new Map());

    const [row] = await svc.dashboard(user, '2026-07', 'd1');

    expect(row.inputs.presentDays).toBe(0);
    expect(row.inputs.lateDays).toBe(0);
  });

  it('scores a dashboard with no holiday repository wired', async () => {
    const { svc } = build({ presentDays: 31, lateDays: 0, noHolidays: true, roster: [EMPLOYEE] });
    const [row] = await svc.dashboard(user, '2026-07', 'd1');
    expect(row.inputs.workingDays).toBe(31);
  });

  it('leaves sales unmeasurable for an employee with no home depot', async () => {
    const homeless = { ...EMPLOYEE, id: 'e9', depotId: null } as unknown as Employee;
    const { svc, sales } = build({ roster: [homeless], sales: 9_000 });
    const [row] = await svc.dashboard(user, '2026-07');
    expect(row.inputs.salesTotal).toBeNull();
    expect(sales?.depotSales).not.toHaveBeenCalled();
  });

  it('returns nothing, and asks nothing, for an empty roster', async () => {
    const { svc, attendance, holidays } = build({ roster: [] });

    expect(await svc.dashboard(user, '2026-07', 'd1')).toEqual([]);
    expect(attendance.summaryMany).not.toHaveBeenCalled();
    expect(holidays?.listDates).not.toHaveBeenCalled();
  });

  it('ranks the dashboard best first and sinks the unmeasurable to the bottom', async () => {
    const other = { ...EMPLOYEE, id: 'e2', employeeCode: 'EMP-002', fullName: 'Sari' } as Employee;
    const { svc } = build({ presentDays: 30, lateDays: 0, roster: [EMPLOYEE, other] });
    const rows = await svc.dashboard(user, '2026-07', 'd1');
    expect(rows).toHaveLength(2);
    expect(rows[0].score.final).toBe(100);
    expect(rows[0]).toMatchObject({ employeeCode: 'EMP-001', position: 'Kurir', depotId: 'd1' });

    const empty = build({
      presentDays: 0,
      lateDays: 0,
      weights: { attendance: 0, discipline: 0, sales: 0 },
      roster: [EMPLOYEE],
    });
    expect((await empty.svc.dashboard(user, '2026-07')).map((r) => r.score.final)).toEqual([null]);

    // Two people, neither measurable: the sort still has to order them without reading a
    // null as a zero.
    const noneMeasurable = build({
      presentDays: 0,
      lateDays: 0,
      weights: { attendance: 0, discipline: 0, sales: 0 },
      roster: [EMPLOYEE, other],
    });
    expect((await noneMeasurable.svc.dashboard(user, '2026-07')).map((r) => r.score.final)).toEqual(
      [null, null],
    );
  });
});
