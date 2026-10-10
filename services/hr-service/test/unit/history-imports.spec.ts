import { plainToInstance } from 'class-transformer';

import { AttendanceService } from '../../src/application/services/attendance.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { ShiftService } from '../../src/application/services/shift.service';
import { AttendanceController } from '../../src/modules/attendance.controller';
import { ShiftRotationController } from '../../src/modules/calendar.controller';
import { PayrollController } from '../../src/modules/payroll.controller';
import {
  ImportAttendanceDto,
  ImportAttendanceRowDto,
  ImportPayrollDto,
  ImportPayrollRowDto,
  ImportShiftRowDto,
  ImportShiftsDto,
} from '../../src/modules/dto/history-import.dto';

const DEPOT = '11111111-1111-1111-1111-111111111111';
const hr = { sub: 'hr-1', role: 'HR' } as never;
const config = { timeZone: 'Asia/Jakarta', depotAssignmentEnabled: false } as never;

describe('attendance history import', () => {
  const employee = { id: 'e1', employeeCode: 'E-1', depotId: DEPOT, homeDepotId: DEPOT };
  function build(opts: { existing?: boolean; unknown?: boolean; slip?: string } = {}) {
    const repo = {
      findByEmployeeAndDate: jest.fn(async () => (opts.existing ? { id: 'old' } : null)),
      upsertManual: jest.fn(async (i: Record<string, unknown>) => ({ id: 'a1', ...i })),
      recordAdjustment: jest.fn(async () => undefined),
    };
    const employees = { findByEmployeeCode: jest.fn(async () => (opts.unknown ? null : employee)) };
    const payrolls = { findByEmployeeAndPeriod: jest.fn(async () => (opts.slip ? { status: opts.slip } : null)) };
    const svc = new AttendanceService(
      repo as never,
      {} as never,
      {} as never,
      employees as never,
      config,
      undefined,
      undefined,
      undefined,
      payrolls as never,
    );
    return { svc, repo, payrolls };
  }
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-10T03:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('stamps the day with the depot and files an adjustment line', async () => {
    const { svc, repo } = build();
    const r = await svc.importHistory(hr, [{ employeeCode: 'E-1', workDate: '2026-09-01', status: 'LATE', lateMinutes: 12 }]);
    expect(r).toMatchObject({ created: 1, failed: 0 });
    expect(repo.upsertManual).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'e1', depotId: DEPOT, status: 'LATE', lateMinutes: 12 }),
    );
    expect(repo.recordAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Impor riwayat absensi', approvedBy: 'hr-1' }),
    );
  });

  it('refuses today and the future, PENDING and unknown people; skips a day that has a record', async () => {
    const { svc, repo } = build();
    const r = await svc.importHistory(hr, [
      { employeeCode: 'E-1', workDate: '2026-10-10', status: 'PRESENT' },
      { employeeCode: 'E-1', workDate: '2026-09-01', status: 'PENDING' as never },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['failed', 'failed']);
    expect(repo.upsertManual).not.toHaveBeenCalled();
    const unknown = await build({ unknown: true }).svc.importHistory(hr, [
      { employeeCode: 'X', workDate: '2026-09-01', status: 'PRESENT' },
    ]);
    expect(unknown.results[0].message).toMatch(/tidak ditemukan/);
    const dup = await build({ existing: true }).svc.importHistory(hr, [
      { employeeCode: 'E-1', workDate: '2026-09-01', status: 'PRESENT' },
    ]);
    expect(dup.results[0]).toMatchObject({ status: 'skipped' });
  });

  it('refuses a month whose slip is already approved or paid, asking once per month', async () => {
    const { svc, repo, payrolls } = build({ slip: 'APPROVED' });
    const r = await svc.importHistory(hr, [
      { employeeCode: 'E-1', workDate: '2026-09-01', status: 'PRESENT' },
      { employeeCode: 'E-1', workDate: '2026-09-02', status: 'PRESENT' },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['failed', 'failed']);
    expect(r.results[0].message).toMatch(/2026-09 sudah disetujui/);
    expect(payrolls.findByEmployeeAndPeriod).toHaveBeenCalledTimes(1);
    expect(repo.upsertManual).not.toHaveBeenCalled();
  });

  it('a DRAFT slip does not block the import', async () => {
    const { svc } = build({ slip: 'DRAFT' });
    const r = await svc.importHistory(hr, [{ employeeCode: 'E-1', workDate: '2026-09-01', status: 'PRESENT' }]);
    expect(r).toMatchObject({ created: 1 });
  });

  it('a non-late day never carries late minutes', async () => {
    const { svc, repo } = build();
    await svc.importHistory(hr, [{ employeeCode: 'E-1', workDate: '2026-09-02', status: 'PRESENT', lateMinutes: 30 }]);
    expect(repo.upsertManual).toHaveBeenCalledWith(expect.objectContaining({ lateMinutes: 0 }));
  });
});

describe('payroll history import', () => {
  function build(opts: { existing?: boolean } = {}) {
    const repo = {
      findByEmployeeAndPeriod: jest.fn(async () => (opts.existing ? { id: 'p0' } : null)),
      create: jest.fn(async (d: Record<string, unknown>) => ({ id: 'p1', ...d })),
      setStatus: jest.fn(async (id: string, _from: string, _to: string, _stamp: unknown) => ({ id })),
    };
    const employees = { getByCode: jest.fn(async () => ({ id: 'e1' })) };
    const svc = new PayrollService(repo as never, {} as never, {} as never, {} as never, employees as never, config);
    return { svc, repo };
  }
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-10T03:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('writes a closed slip: three lines, then approved and paid', async () => {
    const { svc, repo } = build();
    const r = await svc.importHistory(hr, [
      { employeeCode: 'E-1', periodMonth: '2026-08', gross: 3000000, totalBonus: 200000, totalDeduction: 50000, net: 3150000, presentDays: 26 },
    ]);
    expect(r).toMatchObject({ created: 1 });
    const written = repo.create.mock.calls[0][0] as { net: number; items: { kind: string }[] };
    expect(written.net).toBe(3150000);
    expect(written.items.map((i) => i.kind)).toEqual(['BASE', 'BONUS', 'DEDUCTION']);
    expect(repo.setStatus.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['DRAFT', 'APPROVED'],
      ['APPROVED', 'PAID'],
    ]);
  });

  it('carries its single home-depot part when the split is on', async () => {
    const repo = {
      findByEmployeeAndPeriod: async () => null,
      create: jest.fn(async (d: Record<string, unknown>) => ({ id: 'p1', ...d })),
      setStatus: jest.fn(async (id: string) => ({ id })),
    };
    const employees = { getByCode: async () => ({ id: 'e1', depotId: DEPOT, homeDepotId: DEPOT }) };
    const svc = new PayrollService(
      repo as never, {} as never, {} as never, {} as never, employees as never,
      { timeZone: 'Asia/Jakarta', depotAssignmentEnabled: true } as never,
    );
    await svc.importHistory(hr, [
      { employeeCode: 'E-1', periodMonth: '2026-08', gross: 1000, totalBonus: 100, totalDeduction: 50, presentDays: 20 },
    ]);
    expect((repo.create.mock.calls[0][0] as { shares: unknown[] }).shares).toEqual([
      { depotId: DEPOT, days: 20, gross: 1000, bonus: 100, deduction: 50, shortfall: 0, net: 1050 },
    ]);
  });

  it('omits zero bonus/deduction lines and computes net when it is not given', async () => {
    const { svc, repo } = build();
    await svc.importHistory(hr, [{ employeeCode: 'E-1', periodMonth: '2026-08', gross: 1000 }]);
    const written = repo.create.mock.calls[0][0] as { net: number; items: unknown[]; presentDays: number };
    expect(written.items).toHaveLength(1);
    expect(written.net).toBe(1000);
    expect(written.presentDays).toBe(0);
  });

  it('refuses a wrong net, a bad period, this or a later month; skips an existing slip', async () => {
    const { svc, repo } = build();
    const r = await svc.importHistory(hr, [
      { employeeCode: 'E-1', periodMonth: '2026-08', gross: 100, net: 999 },
      { employeeCode: 'E-1', periodMonth: '2026-8', gross: 100 },
      { employeeCode: 'E-1', periodMonth: '2026-10', gross: 100 },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['failed', 'failed', 'failed']);
    expect(repo.create).not.toHaveBeenCalled();
    const dup = await build({ existing: true }).svc.importHistory(hr, [
      { employeeCode: 'E-1', periodMonth: '2026-08', gross: 100 },
    ]);
    expect(dup.results[0]).toMatchObject({ status: 'skipped' });
  });
});

describe('shift history import', () => {
  const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
  function build(opts: { assignments?: { shiftId: string; effectiveFrom: Date }[]; shifts?: unknown[] } = {}) {
    const repo = {
      list: jest.fn(async () =>
        opts.shifts ?? [
          { id: 's-net', name: 'Pagi', depotId: null, active: true },
          { id: 's-own', name: 'pagi', depotId: DEPOT, active: true },
          { id: 's-off', name: 'Pagi', depotId: DEPOT, active: false },
        ],
      ),
      listAssignments: jest.fn(async () => opts.assignments ?? []),
      assign: jest.fn(async (d: Record<string, unknown>) => ({ id: 'as-1', ...d })),
    };
    const employees = { getByCode: jest.fn(async () => ({ id: 'e1', depotId: DEPOT })) };
    return { svc: new ShiftService(repo as never, employees as never), repo };
  }

  it('prefers the depot own shift, case-insensitively, and appends the assignment', async () => {
    const { svc, repo } = build();
    const r = await svc.importAssignments(hr, [{ employeeCode: 'E-1', shiftName: ' PAGI ', effectiveFrom: '2026-03-01' }]);
    expect(r).toMatchObject({ created: 1 });
    expect(repo.assign).toHaveBeenCalledWith(
      expect.objectContaining({ shiftId: 's-own', rotationId: null, effectiveFrom: day('2026-03-01'), note: 'Impor riwayat shift' }),
    );
  });

  it('skips a repeat, fails an unknown shift or date', async () => {
    const dup = await build({ assignments: [{ shiftId: 's-own', effectiveFrom: day('2026-03-01') }] }).svc.importAssignments(
      hr,
      [{ employeeCode: 'E-1', shiftName: 'Pagi', effectiveFrom: '2026-03-01' }],
    );
    expect(dup.results[0]).toMatchObject({ status: 'skipped' });
    const r = await build().svc.importAssignments(hr, [
      { employeeCode: 'E-1', shiftName: 'Malam', effectiveFrom: '2026-03-01' },
      { employeeCode: 'E-1', shiftName: 'Pagi', effectiveFrom: 'bukan-tanggal' },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['failed', 'failed']);
  });

  it('a network-wide shift serves an employee with no shift of their own depot', async () => {
    const { svc, repo } = build({ shifts: [{ id: 's-net', name: 'Pagi', depotId: null, active: true }] });
    await svc.importAssignments(hr, [{ employeeCode: 'E-1', shiftName: 'Pagi', effectiveFrom: '2026-03-01' }]);
    expect(repo.assign).toHaveBeenCalledWith(expect.objectContaining({ shiftId: 's-net' }));
  });
});

describe('routes and DTOs', () => {
  it('each route hands the rows and the caller to its service', async () => {
    const rows = [{}] as never;
    const a = { importHistory: jest.fn().mockResolvedValue(1) };
    const p = { importHistory: jest.fn().mockResolvedValue(2) };
    const s = { importAssignments: jest.fn().mockResolvedValue(3) };
    await new AttendanceController(a as never).import({ rows }, hr);
    await new PayrollController(p as never).import({ rows }, hr);
    await new ShiftRotationController(s as never).importAssignments({ rows }, hr);
    expect(a.importHistory).toHaveBeenCalledWith(hr, rows);
    expect(p.importHistory).toHaveBeenCalledWith(hr, rows);
    expect(s.importAssignments).toHaveBeenCalledWith(hr, rows);
  });

  it('types and coerces the rows', () => {
    const a = plainToInstance(ImportAttendanceDto, { rows: [{ lateMinutes: '5' }] });
    expect(a.rows[0]).toBeInstanceOf(ImportAttendanceRowDto);
    expect(a.rows[0].lateMinutes).toBe(5);
    const p = plainToInstance(ImportPayrollDto, { rows: [{ gross: '100', totalBonus: '1', totalDeduction: '2', net: '99', presentDays: '3' }] });
    expect(p.rows[0]).toBeInstanceOf(ImportPayrollRowDto);
    expect(p.rows[0].gross).toBe(100);
    expect(p.rows[0].net).toBe(99);
    const s = plainToInstance(ImportShiftsDto, { rows: [{}] });
    expect(s.rows[0]).toBeInstanceOf(ImportShiftRowDto);
  });
});

describe('PayrollService.regenerate', () => {
  function build(status: string) {
    const payroll = { id: 'p1', employeeId: 'e1', periodMonth: '2026-09', status };
    const repo = { findById: async () => payroll };
    const svc = new PayrollService(
      repo as never, {} as never, {} as never, {} as never,
      { getById: async () => ({ id: 'e1' }) } as never,
      config,
    );
    const generate = jest.spyOn(svc, 'generate').mockResolvedValue({ id: 'p1' } as never);
    return { svc, generate };
  }

  it('recomputes a DRAFT by its employee and month', async () => {
    const { svc, generate } = build('DRAFT');
    await svc.regenerate(hr, 'p1');
    expect(generate).toHaveBeenCalledWith(hr, 'e1', '2026-09');
  });

  it('leaves an approved or paid slip alone', async () => {
    for (const status of ['APPROVED', 'PAID']) {
      const { svc, generate } = build(status);
      await expect(svc.regenerate(hr, 'p1')).rejects.toThrow(/Hanya payroll DRAFT/);
      expect(generate).not.toHaveBeenCalled();
    }
  });
});
