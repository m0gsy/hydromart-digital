import { Logger } from '@nestjs/common';

import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ShiftPrismaRepository } from '../../src/infrastructure/prisma/shift.prisma.repository';
import { AllowancePrismaRepository } from '../../src/infrastructure/prisma/allowance.prisma.repository';
import {
  BonusPrismaRepository,
  DeductionPrismaRepository,
} from '../../src/infrastructure/prisma/adjustment.prisma.repository';
import { AnalyticsPrismaRepository } from '../../src/infrastructure/prisma/analytics.prisma.repository';
import { AttendancePrismaRepository } from '../../src/infrastructure/prisma/attendance.prisma.repository';
import { AuditPrismaRepository } from '../../src/infrastructure/prisma/audit.prisma.repository';
import { BonusRulePrismaRepository } from '../../src/infrastructure/prisma/bonus-rule.prisma.repository';
import { EmployeePrismaRepository } from '../../src/infrastructure/prisma/employee.prisma.repository';
import { FaceEmbeddingPrismaRepository } from '../../src/infrastructure/prisma/face-embedding.prisma.repository';
import { HolidayPrismaRepository } from '../../src/infrastructure/prisma/holiday.prisma.repository';
import { LoanPrismaRepository } from '../../src/infrastructure/prisma/loan.prisma.repository';
import { PayrollPrismaRepository } from '../../src/infrastructure/prisma/payroll.prisma.repository';
import { PerformancePrismaRepository } from '../../src/infrastructure/prisma/performance.prisma.repository';
import { SettingsPrismaRepository } from '../../src/infrastructure/prisma/settings.prisma.repository';

// ── Typed prisma double ───────────────────────────────────────────────
// Every repo here is a thin passthrough, so we mock PrismaService as a bag
// of jest.fn() model accessors and assert the where/data/orderBy handed to
// Prisma plus that the return value flows straight back.

type ModelMock = Record<string, jest.Mock>;

function model(): ModelMock {
  return {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  };
}

const MODELS = [
  'shift',
  'allowance',
  'bonus',
  'deduction',
  'employee',
  'employmentHistory',
  'attendance',
  'attendanceAdjustment',
  'auditLog',
  'bonusRule',
  'faceEmbedding',
  'holiday',
  'loan',
  'payroll',
  'payrollItem',
  'performanceReview',
  'serviceSetting',
];

type FakePrisma = Record<string, ModelMock | jest.Mock>;

function makePrisma(): FakePrisma {
  const client: FakePrisma = {};
  for (const name of MODELS) client[name] = model();
  client.$connect = jest.fn();
  client.$disconnect = jest.fn();
  // Array form → resolve every op; callback form → run against the same client.
  client.$transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client),
  );
  return client;
}

function asService(p: FakePrisma): PrismaService {
  return p as unknown as PrismaService;
}

function m(p: FakePrisma, name: string): ModelMock {
  return p[name] as ModelMock;
}

function tx(p: FakePrisma): jest.Mock {
  return p.$transaction as jest.Mock;
}

// A sentinel that Prisma "returns"; identity is asserted with toBe.
const sentinel = (): object => ({ id: `s-${Math.random()}` });

// ── AllowancePrismaRepository ──────────────────────────────────────────
describe('AllowancePrismaRepository', () => {
  const write = {
    employeeId: 'e1',
    type: 'TRANSPORT' as const,
    amount: 300_000,
    effectiveFrom: new Date('2026-08-01'),
    effectiveTo: null,
    active: true,
    note: null,
    createdBy: 'hr-1',
  };

  it('create/update/findById are straight passthroughs', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'allowance').create.mockResolvedValue(out);
    m(p, 'allowance').update.mockResolvedValue(out);
    m(p, 'allowance').findUnique.mockResolvedValue(out);
    const repo = new AllowancePrismaRepository(asService(p));

    await expect(repo.create(write)).resolves.toBe(out);
    expect(m(p, 'allowance').create).toHaveBeenCalledWith({ data: write });
    await expect(repo.update('a1', { active: false })).resolves.toBe(out);
    expect(m(p, 'allowance').update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { active: false },
    });
    await expect(repo.findById('a1')).resolves.toBe(out);
  });

  it('listByEmployee puts the active rows first', async () => {
    const p = makePrisma();
    m(p, 'allowance').findMany.mockResolvedValue([]);
    await new AllowancePrismaRepository(asService(p)).listByEmployee('e1');
    expect(m(p, 'allowance').findMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1' },
      orderBy: [{ active: 'desc' }, { effectiveFrom: 'desc' }],
    });
  });

  it('listActiveForPeriod takes rows that overlap the period and are still open', async () => {
    const p = makePrisma();
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-31');
    m(p, 'allowance').findMany.mockResolvedValue([]);
    await new AllowancePrismaRepository(asService(p)).listActiveForPeriod('e1', from, to);
    expect(m(p, 'allowance').findMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'e1',
        active: true,
        effectiveFrom: { lte: to },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
  });
});

// ── ShiftPrismaRepository ──────────────────────────────────────────────
describe('ShiftPrismaRepository', () => {
  const write = {
    depotId: 'd1',
    name: 'Morning',
    startTime: '08:00',
    endTime: '16:00',
    active: true,
  };

  it('create → shift.create({ data })', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'shift').create.mockResolvedValue(out);
    const repo = new ShiftPrismaRepository(asService(p));
    await expect(repo.create(write)).resolves.toBe(out);
    expect(m(p, 'shift').create).toHaveBeenCalledWith({ data: write });
  });

  it('update → shift.update({ where, data })', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'shift').update.mockResolvedValue(out);
    const repo = new ShiftPrismaRepository(asService(p));
    await expect(repo.update('id1', { active: false })).resolves.toBe(out);
    expect(m(p, 'shift').update).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { active: false },
    });
  });

  it('delete → shift.delete({ where })', async () => {
    const p = makePrisma();
    m(p, 'shift').delete.mockResolvedValue({});
    const repo = new ShiftPrismaRepository(asService(p));
    await expect(repo.delete('id1')).resolves.toBeUndefined();
    expect(m(p, 'shift').delete).toHaveBeenCalledWith({ where: { id: 'id1' } });
  });

  it('findById → shift.findUnique', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'shift').findUnique.mockResolvedValue(out);
    const repo = new ShiftPrismaRepository(asService(p));
    await expect(repo.findById('id1')).resolves.toBe(out);
    expect(m(p, 'shift').findUnique).toHaveBeenCalledWith({ where: { id: 'id1' } });
  });

  it('list(depotId) filters; list() does not', async () => {
    const p = makePrisma();
    m(p, 'shift').findMany.mockResolvedValue([]);
    const repo = new ShiftPrismaRepository(asService(p));
    await repo.list('d1');
    expect(m(p, 'shift').findMany).toHaveBeenCalledWith({
      where: { depotId: 'd1' },
      orderBy: [{ depotId: 'asc' }, { startTime: 'asc' }],
    });
    await repo.list();
    expect(m(p, 'shift').findMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: [{ depotId: 'asc' }, { startTime: 'asc' }],
    });
  });

  it('findActiveForDepot → findFirst with OR + orderBy', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'shift').findFirst.mockResolvedValue(out);
    const repo = new ShiftPrismaRepository(asService(p));
    await expect(repo.findActiveForDepot('d1')).resolves.toBe(out);
    expect(m(p, 'shift').findFirst).toHaveBeenCalledWith({
      where: { active: true, OR: [{ depotId: 'd1' }, { depotId: null }] },
      orderBy: { depotId: 'desc' },
    });
  });
});

// ── Bonus / Deduction (adjustment) ─────────────────────────────────────
describe('Bonus/Deduction adjustment repositories', () => {
  it('BonusPrismaRepository forwards create + listByEmployeePeriod', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'bonus').create.mockResolvedValue(out);
    m(p, 'bonus').findMany.mockResolvedValue([]);
    const repo = new BonusPrismaRepository(asService(p));
    const data = {
      employeeId: 'e1',
      type: 'MANUAL' as const,
      amount: 100,
      periodMonth: '2026-07',
      note: null,
      createdBy: null,
    };
    await expect(repo.create(data)).resolves.toBe(out);
    expect(m(p, 'bonus').create).toHaveBeenCalledWith({ data });
    await repo.listByEmployeePeriod('e1', '2026-07');
    expect(m(p, 'bonus').findMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1', periodMonth: '2026-07' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('DeductionPrismaRepository forwards create + listByEmployeePeriod', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'deduction').create.mockResolvedValue(out);
    m(p, 'deduction').findMany.mockResolvedValue([]);
    const repo = new DeductionPrismaRepository(asService(p));
    const data = {
      employeeId: 'e1',
      type: 'MANUAL' as const,
      amount: 50,
      periodMonth: '2026-07',
      note: 'x',
      createdBy: 'hr',
    };
    await expect(repo.create(data)).resolves.toBe(out);
    expect(m(p, 'deduction').create).toHaveBeenCalledWith({ data });
    await repo.listByEmployeePeriod('e1', '2026-07');
    expect(m(p, 'deduction').findMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1', periodMonth: '2026-07' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

// ── AnalyticsPrismaRepository ──────────────────────────────────────────
describe('AnalyticsPrismaRepository', () => {
  it('headcountByStatus maps groupBy rows', async () => {
    const p = makePrisma();
    m(p, 'employee').groupBy.mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 5 } }]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await expect(repo.headcountByStatus('d1')).resolves.toEqual([{ key: 'ACTIVE', count: 5 }]);
    expect(m(p, 'employee').groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { depotId: 'd1' },
      _count: { _all: true },
    });
  });

  it('headcountByEmploymentStatus maps groupBy rows (ACTIVE only)', async () => {
    const p = makePrisma();
    m(p, 'employee').groupBy.mockResolvedValue([
      { employmentStatus: 'PERMANENT', _count: { _all: 3 } },
    ]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await expect(repo.headcountByEmploymentStatus()).resolves.toEqual([
      { key: 'PERMANENT', count: 3 },
    ]);
    expect(m(p, 'employee').groupBy).toHaveBeenCalledWith({
      by: ['employmentStatus'],
      where: { depotId: undefined, status: 'ACTIVE' },
      _count: { _all: true },
    });
  });

  it('attendanceByStatus maps groupBy rows', async () => {
    const p = makePrisma();
    const wd = new Date('2026-07-01');
    m(p, 'attendance').groupBy.mockResolvedValue([{ status: 'PRESENT', _count: { _all: 2 } }]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await expect(repo.attendanceByStatus(wd, 'd1')).resolves.toEqual([
      { key: 'PRESENT', count: 2 },
    ]);
    expect(m(p, 'attendance').groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { workDate: wd, depotId: 'd1' },
      _count: { _all: true },
    });
  });

  it('payrollTotals converts Decimals (and null → 0), scoped by depot', async () => {
    const p = makePrisma();
    const dec = (n: number): Prisma.Decimal => ({ toNumber: () => n }) as unknown as Prisma.Decimal;
    m(p, 'payroll').aggregate.mockResolvedValue({
      _sum: { gross: dec(1000), totalBonus: dec(100), totalDeduction: null, net: dec(900) },
      _count: { _all: 4 },
    });
    const repo = new AnalyticsPrismaRepository(asService(p));
    await expect(repo.payrollTotals('2026-07', 'd1')).resolves.toEqual({
      gross: 1000,
      totalBonus: 100,
      totalDeduction: 0,
      net: 900,
      count: 4,
    });
    expect(m(p, 'payroll').aggregate).toHaveBeenCalledWith({
      where: { periodMonth: '2026-07', employee: { depotId: 'd1' } },
      _sum: { gross: true, totalBonus: true, totalDeduction: true, net: true },
      _count: { _all: true },
    });
  });

  it('payrollTotals without depot omits the employee filter', async () => {
    const p = makePrisma();
    m(p, 'payroll').aggregate.mockResolvedValue({
      _sum: { gross: null, totalBonus: null, totalDeduction: null, net: null },
      _count: { _all: 0 },
    });
    const repo = new AnalyticsPrismaRepository(asService(p));
    await expect(repo.payrollTotals('2026-07')).resolves.toEqual({
      gross: 0,
      totalBonus: 0,
      totalDeduction: 0,
      net: 0,
      count: 0,
    });
    expect(m(p, 'payroll').aggregate).toHaveBeenCalledWith({
      where: { periodMonth: '2026-07' },
      _sum: { gross: true, totalBonus: true, totalDeduction: true, net: true },
      _count: { _all: true },
    });
  });

  it('payrollByStatus maps groupBy rows, scoped by depot', async () => {
    const p = makePrisma();
    m(p, 'payroll').groupBy.mockResolvedValue([{ status: 'PAID', _count: { _all: 7 } }]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await expect(repo.payrollByStatus('2026-07', 'd1')).resolves.toEqual([
      { key: 'PAID', count: 7 },
    ]);
    expect(m(p, 'payroll').groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { periodMonth: '2026-07', employee: { depotId: 'd1' } },
      _count: { _all: true },
    });
  });

  it('payrollByStatus / payrollForReport without depot omit the employee filter', async () => {
    const p = makePrisma();
    m(p, 'payroll').groupBy.mockResolvedValue([]);
    m(p, 'payroll').findMany.mockResolvedValue([]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await repo.payrollByStatus('2026-07');
    expect(m(p, 'payroll').groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { periodMonth: '2026-07' },
      _count: { _all: true },
    });
    await repo.payrollForReport('2026-07');
    expect(m(p, 'payroll').findMany).toHaveBeenCalledWith({
      where: { periodMonth: '2026-07' },
      include: { employee: { select: { employeeCode: true, fullName: true } } },
      orderBy: { employee: { employeeCode: 'asc' } },
    });
  });

  it('employeesForReport → employee.findMany ordered by code', async () => {
    const p = makePrisma();
    m(p, 'employee').findMany.mockResolvedValue([]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await repo.employeesForReport('d1');
    expect(m(p, 'employee').findMany).toHaveBeenCalledWith({
      where: { depotId: 'd1' },
      orderBy: { employeeCode: 'asc' },
    });
  });

  it('attendanceForReport → attendance.findMany with range + include, excluding PENDING', async () => {
    const p = makePrisma();
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-31');
    m(p, 'attendance').findMany.mockResolvedValue([]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await repo.attendanceForReport(from, to, 'd1');
    expect(m(p, 'attendance').findMany).toHaveBeenCalledWith({
      where: { workDate: { gte: from, lte: to }, depotId: 'd1', status: { not: 'PENDING' } },
      include: { employee: { select: { employeeCode: true, fullName: true } } },
      orderBy: [{ workDate: 'asc' }, { employeeId: 'asc' }],
    });
  });

  it('payrollForReport → payroll.findMany scoped + include', async () => {
    const p = makePrisma();
    m(p, 'payroll').findMany.mockResolvedValue([]);
    const repo = new AnalyticsPrismaRepository(asService(p));
    await repo.payrollForReport('2026-07', 'd1');
    expect(m(p, 'payroll').findMany).toHaveBeenCalledWith({
      where: { periodMonth: '2026-07', employee: { depotId: 'd1' } },
      include: { employee: { select: { employeeCode: true, fullName: true } } },
      orderBy: { employee: { employeeCode: 'asc' } },
    });
  });
});

// ── AttendancePrismaRepository ─────────────────────────────────────────
describe('AttendancePrismaRepository', () => {
  it('findByEmployeeAndDate → composite findUnique', async () => {
    const p = makePrisma();
    const wd = new Date('2026-07-01');
    const out = sentinel();
    m(p, 'attendance').findUnique.mockResolvedValue(out);
    const repo = new AttendancePrismaRepository(asService(p));
    await expect(repo.findByEmployeeAndDate('e1', wd)).resolves.toBe(out);
    expect(m(p, 'attendance').findUnique).toHaveBeenCalledWith({
      where: { employeeId_workDate: { employeeId: 'e1', workDate: wd } },
    });
  });

  it('findById → findUnique by id', async () => {
    const p = makePrisma();
    m(p, 'attendance').findUnique.mockResolvedValue(null);
    const repo = new AttendancePrismaRepository(asService(p));
    await expect(repo.findById('a1')).resolves.toBeNull();
    expect(m(p, 'attendance').findUnique).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('upsertManual with full patch builds create+update', async () => {
    const p = makePrisma();
    const wd = new Date('2026-07-01');
    const ci = new Date('2026-07-01T08:00:00Z');
    const co = new Date('2026-07-01T16:00:00Z');
    m(p, 'attendance').upsert.mockResolvedValue(sentinel());
    const repo = new AttendancePrismaRepository(asService(p));
    await repo.upsertManual({
      employeeId: 'e1',
      depotId: 'd1',
      workDate: wd,
      status: 'LATE',
      lateMinutes: 5,
      checkInAt: ci,
      checkOutAt: co,
    });
    expect(m(p, 'attendance').upsert).toHaveBeenCalledWith({
      where: { employeeId_workDate: { employeeId: 'e1', workDate: wd } },
      create: {
        employeeId: 'e1',
        depotId: 'd1',
        workDate: wd,
        lateMinutes: 5,
        status: 'LATE',
        checkInAt: ci,
        checkOutAt: co,
      },
      update: { status: 'LATE', lateMinutes: 5, checkInAt: ci, checkOutAt: co },
    });
  });

  it('upsertManual with minimal input defaults lateMinutes to 0', async () => {
    const p = makePrisma();
    const wd = new Date('2026-07-01');
    m(p, 'attendance').upsert.mockResolvedValue(sentinel());
    const repo = new AttendancePrismaRepository(asService(p));
    await repo.upsertManual({ employeeId: 'e1', depotId: 'd1', workDate: wd, status: 'ABSENT' });
    expect(m(p, 'attendance').upsert).toHaveBeenCalledWith({
      where: { employeeId_workDate: { employeeId: 'e1', workDate: wd } },
      create: { employeeId: 'e1', depotId: 'd1', workDate: wd, lateMinutes: 0, status: 'ABSENT' },
      update: { status: 'ABSENT' },
    });
  });

  it('recordAdjustment serializes before/after, null → JsonNull', async () => {
    const p = makePrisma();
    m(p, 'attendanceAdjustment').create.mockResolvedValue({});
    const repo = new AttendancePrismaRepository(asService(p));
    await repo.recordAdjustment({
      attendanceId: 'a1',
      reason: 'fix',
      before: { x: 1 },
      after: null,
      approvedBy: 'hr',
    });
    expect(m(p, 'attendanceAdjustment').create).toHaveBeenCalledWith({
      data: {
        attendanceId: 'a1',
        reason: 'fix',
        before: { x: 1 },
        after: Prisma.JsonNull,
        approvedBy: 'hr',
      },
    });
  });

  it('create → attendance.create({ data })', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'attendance').create.mockResolvedValue(out);
    const repo = new AttendancePrismaRepository(asService(p));
    const input = {
      employeeId: 'e1',
      depotId: 'd1',
      workDate: new Date('2026-07-01'),
      checkInAt: new Date(),
      checkInPhotoUrl: null,
      checkInScore: 0.9,
      checkInLat: 1,
      checkInLng: 2,
      lateMinutes: 0,
      status: 'PRESENT' as const,
    };
    await expect(repo.create(input)).resolves.toBe(out);
    expect(m(p, 'attendance').create).toHaveBeenCalledWith({ data: input });
  });

  it('summary runs 3 counts in a transaction', async () => {
    const p = makePrisma();
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-31');
    m(p, 'attendance')
      .count.mockResolvedValueOnce(20)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    const repo = new AttendancePrismaRepository(asService(p));
    await expect(repo.summary('e1', from, to)).resolves.toEqual({
      presentDays: 20,
      lateDays: 3,
      leaveDays: 1,
    });
    expect(tx(p)).toHaveBeenCalled();
    const wd = { gte: from, lte: to };
    expect(m(p, 'attendance').count).toHaveBeenNthCalledWith(1, {
      where: { employeeId: 'e1', workDate: wd, status: { in: ['PRESENT', 'LATE'] } },
    });
    expect(m(p, 'attendance').count).toHaveBeenNthCalledWith(2, {
      where: { employeeId: 'e1', workDate: wd, status: 'LATE' },
    });
    expect(m(p, 'attendance').count).toHaveBeenNthCalledWith(3, {
      where: { employeeId: 'e1', workDate: wd, status: 'LEAVE' },
    });
  });

  it('patchCheckOut → attendance.update', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'attendance').update.mockResolvedValue(out);
    const repo = new AttendancePrismaRepository(asService(p));
    const patch = {
      checkOutAt: new Date(),
      checkOutPhotoUrl: null,
      checkOutScore: 0.8,
      checkOutLat: 1,
      checkOutLng: 2,
      workingMinutes: 480,
    };
    await expect(repo.patchCheckOut('a1', patch)).resolves.toBe(out);
    expect(m(p, 'attendance').update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: patch });
  });

  it('patchStatus → attendance.update with the settled status', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'attendance').update.mockResolvedValue(out);
    const repo = new AttendancePrismaRepository(asService(p));
    await expect(repo.patchStatus('a1', 'ABSENT')).resolves.toBe(out);
    expect(m(p, 'attendance').update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'ABSENT' },
    });
  });

  it('list filters by status for the PENDING approval queue', async () => {
    const p = makePrisma();
    m(p, 'attendance').findMany.mockResolvedValue([]);
    m(p, 'attendance').count.mockResolvedValue(0);
    const repo = new AttendancePrismaRepository(asService(p));
    await repo.list({ status: 'PENDING', skip: 0, take: 1 });
    expect(m(p, 'attendance').findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      orderBy: { workDate: 'desc' },
      skip: 0,
      take: 1,
    });
  });

  it('list builds full where from filter and paginates in a transaction', async () => {
    const p = makePrisma();
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-31');
    const rows = [sentinel()];
    m(p, 'attendance').findMany.mockResolvedValue(rows);
    m(p, 'attendance').count.mockResolvedValue(1);
    const repo = new AttendancePrismaRepository(asService(p));
    await expect(
      repo.list({ depotId: 'd1', employeeId: 'e1', from, to, skip: 10, take: 5 }),
    ).resolves.toEqual({ rows, total: 1 });
    const where = { depotId: 'd1', employeeId: 'e1', workDate: { gte: from, lte: to } };
    expect(m(p, 'attendance').findMany).toHaveBeenCalledWith({
      where,
      orderBy: { workDate: 'desc' },
      skip: 10,
      take: 5,
    });
    expect(m(p, 'attendance').count).toHaveBeenCalledWith({ where });
  });

  it('list with empty filter yields empty where', async () => {
    const p = makePrisma();
    m(p, 'attendance').findMany.mockResolvedValue([]);
    m(p, 'attendance').count.mockResolvedValue(0);
    const repo = new AttendancePrismaRepository(asService(p));
    await repo.list({ skip: 0, take: 20 });
    expect(m(p, 'attendance').findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { workDate: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('list with an open-ended range covers gte-only and lte-only', async () => {
    const p = makePrisma();
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-31');
    m(p, 'attendance').findMany.mockResolvedValue([]);
    m(p, 'attendance').count.mockResolvedValue(0);
    const repo = new AttendancePrismaRepository(asService(p));
    await repo.list({ from, skip: 0, take: 20 });
    expect(m(p, 'attendance').findMany).toHaveBeenLastCalledWith({
      where: { workDate: { gte: from } },
      orderBy: { workDate: 'desc' },
      skip: 0,
      take: 20,
    });
    await repo.list({ to, skip: 0, take: 20 });
    expect(m(p, 'attendance').findMany).toHaveBeenLastCalledWith({
      where: { workDate: { lte: to } },
      orderBy: { workDate: 'desc' },
      skip: 0,
      take: 20,
    });
  });
});

// ── AuditPrismaRepository ──────────────────────────────────────────────
describe('AuditPrismaRepository', () => {
  it('write serializes snapshots (non-null passthrough)', async () => {
    const p = makePrisma();
    m(p, 'auditLog').create.mockResolvedValue({});
    const repo = new AuditPrismaRepository(asService(p));
    await repo.write({
      actorId: 'u1',
      action: 'UPDATE',
      entity: 'Employee',
      entityId: 'e1',
      before: { a: 1 },
      after: { a: 2 },
      ip: '127.0.0.1',
    });
    expect(m(p, 'auditLog').create).toHaveBeenCalledWith({
      data: {
        actorId: 'u1',
        action: 'UPDATE',
        entity: 'Employee',
        entityId: 'e1',
        before: { a: 1 },
        after: { a: 2 },
        ip: '127.0.0.1',
      },
    });
  });

  it('write maps nullish snapshots to JsonNull', async () => {
    const p = makePrisma();
    m(p, 'auditLog').create.mockResolvedValue({});
    const repo = new AuditPrismaRepository(asService(p));
    await repo.write({
      actorId: null,
      action: 'DELETE',
      entity: 'Loan',
      entityId: null,
      before: null,
      after: null,
      ip: null,
    });
    expect(m(p, 'auditLog').create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: 'DELETE',
        entity: 'Loan',
        entityId: null,
        before: Prisma.JsonNull,
        after: Prisma.JsonNull,
        ip: null,
      },
    });
  });

  it('list paginates in a transaction', async () => {
    const p = makePrisma();
    const rows = [sentinel()];
    m(p, 'auditLog').findMany.mockResolvedValue(rows);
    m(p, 'auditLog').count.mockResolvedValue(1);
    const repo = new AuditPrismaRepository(asService(p));
    await expect(
      repo.list({ entity: 'Employee', entityId: 'e1', actorId: 'u1', skip: 0, take: 50 }),
    ).resolves.toEqual({ rows, total: 1 });
    const where = { entity: 'Employee', entityId: 'e1', actorId: 'u1' };
    expect(m(p, 'auditLog').findMany).toHaveBeenCalledWith({
      where,
      orderBy: { at: 'desc' },
      skip: 0,
      take: 50,
    });
    expect(m(p, 'auditLog').count).toHaveBeenCalledWith({ where });
  });
});

// ── BonusRulePrismaRepository ──────────────────────────────────────────
describe('BonusRulePrismaRepository', () => {
  const write = {
    depotId: 'd1',
    bonusType: 'ATTENDANCE' as const,
    name: 'Perfect',
    metric: 'present',
    op: '>=',
    threshold: 26,
    rewardKind: 'FIXED',
    rewardValue: 100000,
    active: true,
    createdBy: 'hr',
  };

  it('create/update/findById passthrough', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'bonusRule').create.mockResolvedValue(out);
    m(p, 'bonusRule').update.mockResolvedValue(out);
    m(p, 'bonusRule').findUnique.mockResolvedValue(out);
    const repo = new BonusRulePrismaRepository(asService(p));
    await expect(repo.create(write)).resolves.toBe(out);
    expect(m(p, 'bonusRule').create).toHaveBeenCalledWith({ data: write });
    await expect(repo.update('r1', { active: false })).resolves.toBe(out);
    expect(m(p, 'bonusRule').update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { active: false },
    });
    await expect(repo.findById('r1')).resolves.toBe(out);
    expect(m(p, 'bonusRule').findUnique).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('listActiveForDepot merges depot + global defaults', async () => {
    const p = makePrisma();
    m(p, 'bonusRule').findMany.mockResolvedValue([]);
    const repo = new BonusRulePrismaRepository(asService(p));
    await repo.listActiveForDepot('d1');
    expect(m(p, 'bonusRule').findMany).toHaveBeenCalledWith({
      where: { active: true, OR: [{ depotId: 'd1' }, { depotId: null }] },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('list scopes: undefined → all, null → global, id → depot', async () => {
    const p = makePrisma();
    m(p, 'bonusRule').findMany.mockResolvedValue([]);
    const repo = new BonusRulePrismaRepository(asService(p));
    await repo.list();
    expect(m(p, 'bonusRule').findMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
    });
    await repo.list(null);
    expect(m(p, 'bonusRule').findMany).toHaveBeenLastCalledWith({
      where: { depotId: null },
      orderBy: { createdAt: 'desc' },
    });
    await repo.list('d1');
    expect(m(p, 'bonusRule').findMany).toHaveBeenLastCalledWith({
      where: { depotId: 'd1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

// ── EmployeePrismaRepository ───────────────────────────────────────────
describe('EmployeePrismaRepository retention (M23-21)', () => {
  const CUTOFF = new Date('2026-01-01T00:00:00.000Z');
  const DEPARTED = { status: { in: ['RESIGNED', 'INACTIVE'] }, updatedAt: { lt: CUTOFF } };

  it('counts only departed rows dormant since before the cutoff', async () => {
    const p = makePrisma();
    m(p, 'employee').count.mockResolvedValue(5);
    expect(await new EmployeePrismaRepository(p as never).countRetentionEligible(CUTOFF)).toBe(5);
    expect(m(p, 'employee').count).toHaveBeenCalledWith({ where: DEPARTED });
  });

  it('does nothing at all when no record is eligible', async () => {
    const p = makePrisma();
    m(p, 'employee').findMany.mockResolvedValue([]);
    expect(await new EmployeePrismaRepository(p as never).anonymiseRetentionEligible(CUTOFF)).toBe(0);
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it('deletes the non-financial rows and strips identity — money records untouched', async () => {
    const p = makePrisma();
    m(p, 'employee').findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);

    const out = await new EmployeePrismaRepository(p as never).anonymiseRetentionEligible(CUTOFF);

    expect(out).toBe(2);
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    const ids = { employeeId: { in: ['e1', 'e2'] } };
    expect(m(p, 'faceEmbedding').deleteMany).toHaveBeenCalledWith({ where: ids });
    expect(m(p, 'attendance').deleteMany).toHaveBeenCalledWith({ where: ids });
    expect(m(p, 'performanceReview').deleteMany).toHaveBeenCalledWith({ where: ids });
    // Payroll, bonuses, deductions and loans are proof that wages were paid: they must
    // survive a tax audit, so the sweep must never touch them.
    expect(m(p, 'payroll').deleteMany).not.toHaveBeenCalled();
    expect(m(p, 'bonus').deleteMany).not.toHaveBeenCalled();
    expect(m(p, 'deduction').deleteMany).not.toHaveBeenCalled();
    expect(m(p, 'loan').deleteMany).not.toHaveBeenCalled();
    // The employee row survives too — deleting it would orphan those money records.
    expect(m(p, 'employee').deleteMany).not.toHaveBeenCalled();
    expect(m(p, 'employee').updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1', 'e2'] } },
      data: {
        fullName: 'Karyawan dihapus',
        phone: '-',
        email: null,
        photoUrl: null,
        authSubjectId: null,
      },
    });
  });

  it('purges biometrics through the employee relation, on their own window', async () => {
    const p = makePrisma();
    m(p, 'faceEmbedding').deleteMany.mockResolvedValue({ count: 4 });
    expect(await new EmployeePrismaRepository(p as never).purgeFaceEmbeddings(CUTOFF)).toBe(4);
    expect(m(p, 'faceEmbedding').deleteMany).toHaveBeenCalledWith({
      where: { employee: DEPARTED },
    });
  });
});

describe('EmployeePrismaRepository', () => {
  it('count → employee.count()', async () => {
    const p = makePrisma();
    m(p, 'employee').count.mockResolvedValue(42);
    const repo = new EmployeePrismaRepository(asService(p));
    await expect(repo.count()).resolves.toBe(42);
    expect(m(p, 'employee').count).toHaveBeenCalledWith();
  });

  it('list builds where with depot/status/search and paginates', async () => {
    const p = makePrisma();
    const rows = [sentinel()];
    m(p, 'employee').findMany.mockResolvedValue(rows);
    m(p, 'employee').count.mockResolvedValue(1);
    const repo = new EmployeePrismaRepository(asService(p));
    await expect(
      repo.list({ depotId: 'd1', status: 'ACTIVE', search: 'ali', skip: 5, take: 10 }),
    ).resolves.toEqual({ rows, total: 1 });
    const where = {
      depotId: 'd1',
      status: 'ACTIVE',
      OR: [
        { fullName: { contains: 'ali', mode: 'insensitive' } },
        { employeeCode: { contains: 'ali', mode: 'insensitive' } },
        { phone: { contains: 'ali' } },
      ],
    };
    expect(m(p, 'employee').findMany).toHaveBeenCalledWith({
      where,
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 10,
    });
    expect(m(p, 'employee').count).toHaveBeenCalledWith({ where });
  });

  it('list with empty filter yields empty where', async () => {
    const p = makePrisma();
    m(p, 'employee').findMany.mockResolvedValue([]);
    m(p, 'employee').count.mockResolvedValue(0);
    const repo = new EmployeePrismaRepository(asService(p));
    await repo.list({ skip: 0, take: 20 });
    expect(m(p, 'employee').findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('findById / findByAuthSubjectId / listHistory passthrough', async () => {
    const p = makePrisma();
    m(p, 'employee').findUnique.mockResolvedValue(null);
    m(p, 'employmentHistory').findMany.mockResolvedValue([]);
    const repo = new EmployeePrismaRepository(asService(p));
    await repo.findById('e1');
    expect(m(p, 'employee').findUnique).toHaveBeenCalledWith({ where: { id: 'e1' } });
    await repo.findByAuthSubjectId('auth1');
    expect(m(p, 'employee').findUnique).toHaveBeenLastCalledWith({
      where: { authSubjectId: 'auth1' },
    });
    await repo.listHistory('e1');
    expect(m(p, 'employmentHistory').findMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('create nests history only when provided', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'employee').create.mockResolvedValue(out);
    const repo = new EmployeePrismaRepository(asService(p));
    const data = { fullName: 'A' } as unknown as Prisma.EmployeeCreateInput;
    const hist = { field: 'x' } as unknown as Prisma.EmploymentHistoryCreateWithoutEmployeeInput;
    await repo.create(data, hist);
    expect(m(p, 'employee').create).toHaveBeenCalledWith({
      data: { ...data, history: { create: hist } },
    });
    await repo.create(data);
    expect(m(p, 'employee').create).toHaveBeenLastCalledWith({ data });
  });

  it('update nests history only when the array is non-empty', async () => {
    const p = makePrisma();
    m(p, 'employee').update.mockResolvedValue(sentinel());
    const repo = new EmployeePrismaRepository(asService(p));
    const data = { fullName: 'B' } as unknown as Prisma.EmployeeUpdateInput;
    const hist = [
      { field: 'x' },
    ] as unknown as Prisma.EmploymentHistoryCreateWithoutEmployeeInput[];
    await repo.update('e1', data, hist);
    expect(m(p, 'employee').update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { ...data, history: { create: hist } },
    });
    await repo.update('e1', data, []);
    expect(m(p, 'employee').update).toHaveBeenLastCalledWith({ where: { id: 'e1' }, data });
  });
});

// ── FaceEmbeddingPrismaRepository ──────────────────────────────────────
describe('FaceEmbeddingPrismaRepository', () => {
  it('create → faceEmbedding.create', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'faceEmbedding').create.mockResolvedValue(out);
    const repo = new FaceEmbeddingPrismaRepository(asService(p));
    const data = { employeeId: 'e1', vector: [0.1, 0.2], quality: 0.9, sourcePhotoUrl: null };
    await expect(repo.create(data)).resolves.toBe(out);
    expect(m(p, 'faceEmbedding').create).toHaveBeenCalledWith({ data });
  });

  it('listActiveByEmployee filters active', async () => {
    const p = makePrisma();
    m(p, 'faceEmbedding').findMany.mockResolvedValue([]);
    const repo = new FaceEmbeddingPrismaRepository(asService(p));
    await repo.listActiveByEmployee('e1');
    expect(m(p, 'faceEmbedding').findMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1', active: true },
    });
  });

  it('listActiveVectorsExcept selects + maps owned vectors', async () => {
    const p = makePrisma();
    m(p, 'faceEmbedding').findMany.mockResolvedValue([{ employeeId: 'e2', vector: [1, 2] }]);
    const repo = new FaceEmbeddingPrismaRepository(asService(p));
    await expect(repo.listActiveVectorsExcept('e1')).resolves.toEqual([
      { employeeId: 'e2', vector: [1, 2] },
    ]);
    expect(m(p, 'faceEmbedding').findMany).toHaveBeenCalledWith({
      where: { active: true, employeeId: { not: 'e1' } },
      select: { employeeId: true, vector: true },
    });
  });

  it('deactivateForEmployee → updateMany active:false', async () => {
    const p = makePrisma();
    m(p, 'faceEmbedding').updateMany.mockResolvedValue({ count: 2 });
    const repo = new FaceEmbeddingPrismaRepository(asService(p));
    await repo.deactivateForEmployee('e1');
    expect(m(p, 'faceEmbedding').updateMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1', active: true },
      data: { active: false },
    });
  });
});

// ── HolidayPrismaRepository ────────────────────────────────────────────
describe('HolidayPrismaRepository', () => {
  it('create → holiday.create', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'holiday').create.mockResolvedValue(out);
    const repo = new HolidayPrismaRepository(asService(p));
    const data = { date: new Date('2026-08-17'), name: 'Independence', depotId: null };
    await expect(repo.create(data)).resolves.toBe(out);
    expect(m(p, 'holiday').create).toHaveBeenCalledWith({ data });
  });

  it('list builds where from depot + range, and empty', async () => {
    const p = makePrisma();
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');
    m(p, 'holiday').findMany.mockResolvedValue([]);
    const repo = new HolidayPrismaRepository(asService(p));
    await repo.list({ depotId: 'd1', from, to });
    expect(m(p, 'holiday').findMany).toHaveBeenCalledWith({
      where: { depotId: 'd1', date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    await repo.list({});
    expect(m(p, 'holiday').findMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: { date: 'asc' },
    });
    await repo.list({ from });
    expect(m(p, 'holiday').findMany).toHaveBeenLastCalledWith({
      where: { date: { gte: from } },
      orderBy: { date: 'asc' },
    });
    await repo.list({ to });
    expect(m(p, 'holiday').findMany).toHaveBeenLastCalledWith({
      where: { date: { lte: to } },
      orderBy: { date: 'asc' },
    });
  });

  it('delete / findById passthrough', async () => {
    const p = makePrisma();
    m(p, 'holiday').delete.mockResolvedValue({});
    m(p, 'holiday').findUnique.mockResolvedValue(null);
    const repo = new HolidayPrismaRepository(asService(p));
    await expect(repo.delete('h1')).resolves.toBeUndefined();
    expect(m(p, 'holiday').delete).toHaveBeenCalledWith({ where: { id: 'h1' } });
    await repo.findById('h1');
    expect(m(p, 'holiday').findUnique).toHaveBeenCalledWith({ where: { id: 'h1' } });
  });

  it('listDates returns ISO YYYY-MM-DD for national + depot holidays', async () => {
    const p = makePrisma();
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');
    m(p, 'holiday').findMany.mockResolvedValue([{ date: new Date('2026-08-17T00:00:00Z') }]);
    const repo = new HolidayPrismaRepository(asService(p));
    await expect(repo.listDates('d1', from, to)).resolves.toEqual(['2026-08-17']);
    expect(m(p, 'holiday').findMany).toHaveBeenCalledWith({
      where: { date: { gte: from, lte: to }, OR: [{ depotId: null }, { depotId: 'd1' }] },
      select: { date: true },
    });
  });
});

// ── LoanPrismaRepository ───────────────────────────────────────────────
describe('LoanPrismaRepository', () => {
  const write = {
    employeeId: 'e1',
    principal: 1000000,
    installmentAmount: 300000,
    startPeriod: '2026-07',
    note: null,
    active: true,
    createdBy: 'hr',
  };

  it('create/update/findById passthrough', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'loan').create.mockResolvedValue(out);
    m(p, 'loan').update.mockResolvedValue(out);
    m(p, 'loan').findUnique.mockResolvedValue(out);
    const repo = new LoanPrismaRepository(asService(p));
    await expect(repo.create(write)).resolves.toBe(out);
    expect(m(p, 'loan').create).toHaveBeenCalledWith({ data: write });
    await expect(repo.update('l1', { active: false })).resolves.toBe(out);
    expect(m(p, 'loan').update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { active: false },
    });
    await expect(repo.findById('l1')).resolves.toBe(out);
    expect(m(p, 'loan').findUnique).toHaveBeenCalledWith({ where: { id: 'l1' } });
  });

  it('listByEmployee / listActiveByEmployee ordering', async () => {
    const p = makePrisma();
    m(p, 'loan').findMany.mockResolvedValue([]);
    const repo = new LoanPrismaRepository(asService(p));
    await repo.listByEmployee('e1');
    expect(m(p, 'loan').findMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.listActiveByEmployee('e1');
    expect(m(p, 'loan').findMany).toHaveBeenLastCalledWith({
      where: { employeeId: 'e1', active: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});

// ── PayrollPrismaRepository ────────────────────────────────────────────
describe('PayrollPrismaRepository', () => {
  const write = {
    employeeId: 'e1',
    periodMonth: '2026-07',
    gross: 5000000,
    totalBonus: 100000,
    totalDeduction: 50000,
    net: 5050000,
    presentDays: 22,
    createdBy: 'hr',
    items: [{ kind: 'BASE' as const, label: 'Base', amount: 5000000, sourceRef: null }],
  };

  it('findByEmployeeAndPeriod includes items', async () => {
    const p = makePrisma();
    m(p, 'payroll').findUnique.mockResolvedValue(null);
    const repo = new PayrollPrismaRepository(asService(p));
    await repo.findByEmployeeAndPeriod('e1', '2026-07');
    expect(m(p, 'payroll').findUnique).toHaveBeenCalledWith({
      where: { employeeId_periodMonth: { employeeId: 'e1', periodMonth: '2026-07' } },
      include: { items: true },
    });
  });

  it('findById includes items', async () => {
    const p = makePrisma();
    m(p, 'payroll').findUnique.mockResolvedValue(null);
    const repo = new PayrollPrismaRepository(asService(p));
    await repo.findById('pr1');
    expect(m(p, 'payroll').findUnique).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      include: { items: true },
    });
  });

  it('create splits items into nested create', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'payroll').create.mockResolvedValue(out);
    const repo = new PayrollPrismaRepository(asService(p));
    await expect(repo.create(write)).resolves.toBe(out);
    const { items, ...fields } = write;
    expect(m(p, 'payroll').create).toHaveBeenCalledWith({
      data: { ...fields, items: { create: items } },
      include: { items: true },
    });
  });

  it('regenerate drops old items then updates money/day fields in a transaction', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'payrollItem').deleteMany.mockResolvedValue({ count: 1 });
    m(p, 'payroll').update.mockResolvedValue(out);
    const repo = new PayrollPrismaRepository(asService(p));
    await expect(repo.regenerate('pr1', write)).resolves.toBe(out);
    expect(tx(p)).toHaveBeenCalled();
    expect(m(p, 'payrollItem').deleteMany).toHaveBeenCalledWith({ where: { payrollId: 'pr1' } });
    expect(m(p, 'payroll').update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: {
        gross: write.gross,
        totalBonus: write.totalBonus,
        totalDeduction: write.totalDeduction,
        net: write.net,
        presentDays: write.presentDays,
        items: { create: write.items },
      },
      include: { items: true },
    });
  });

  it('setStatus stamps actor/timestamps', async () => {
    const p = makePrisma();
    const out = sentinel();
    const approvedAt = new Date();
    m(p, 'payroll').update.mockResolvedValue(out);
    const repo = new PayrollPrismaRepository(asService(p));
    await expect(repo.setStatus('pr1', 'APPROVED', { approvedBy: 'hr', approvedAt })).resolves.toBe(
      out,
    );
    expect(m(p, 'payroll').update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { status: 'APPROVED', approvedBy: 'hr', approvedAt },
      include: { items: true },
    });
  });

  it('list builds where + paginates in a transaction', async () => {
    const p = makePrisma();
    const rows = [sentinel()];
    m(p, 'payroll').findMany.mockResolvedValue(rows);
    m(p, 'payroll').count.mockResolvedValue(1);
    const repo = new PayrollPrismaRepository(asService(p));
    await expect(
      repo.list({ periodMonth: '2026-07', employeeId: 'e1', status: 'PAID', skip: 0, take: 10 }),
    ).resolves.toEqual({ rows, total: 1 });
    const where = { periodMonth: '2026-07', employeeId: 'e1', status: 'PAID' };
    expect(m(p, 'payroll').findMany).toHaveBeenCalledWith({
      where,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
    });
    expect(m(p, 'payroll').count).toHaveBeenCalledWith({ where });
  });

  it('list with empty filter yields empty where', async () => {
    const p = makePrisma();
    m(p, 'payroll').findMany.mockResolvedValue([]);
    m(p, 'payroll').count.mockResolvedValue(0);
    const repo = new PayrollPrismaRepository(asService(p));
    await repo.list({ skip: 0, take: 10 });
    expect(m(p, 'payroll').findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
    });
  });
});

// ── PerformancePrismaRepository ────────────────────────────────────────
describe('PerformancePrismaRepository', () => {
  it('upsert builds create + update from write', async () => {
    const p = makePrisma();
    const out = sentinel();
    m(p, 'performanceReview').upsert.mockResolvedValue(out);
    const repo = new PerformancePrismaRepository(asService(p));
    const data = {
      employeeId: 'e1',
      periodMonth: '2026-07',
      score: 90,
      metrics: { punctuality: 1 },
      reviewerId: 'hr',
      note: 'ok',
    };
    await expect(repo.upsert(data)).resolves.toBe(out);
    expect(m(p, 'performanceReview').upsert).toHaveBeenCalledWith({
      where: { employeeId_periodMonth: { employeeId: 'e1', periodMonth: '2026-07' } },
      create: {
        employeeId: 'e1',
        periodMonth: '2026-07',
        score: 90,
        metrics: { punctuality: 1 },
        reviewerId: 'hr',
        note: 'ok',
      },
      update: { score: 90, metrics: { punctuality: 1 }, reviewerId: 'hr', note: 'ok' },
    });
  });

  it('listByEmployee / findById passthrough', async () => {
    const p = makePrisma();
    m(p, 'performanceReview').findMany.mockResolvedValue([]);
    m(p, 'performanceReview').findUnique.mockResolvedValue(null);
    const repo = new PerformancePrismaRepository(asService(p));
    await repo.listByEmployee('e1');
    expect(m(p, 'performanceReview').findMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1' },
      orderBy: { periodMonth: 'desc' },
    });
    await repo.findById('pr1');
    expect(m(p, 'performanceReview').findUnique).toHaveBeenCalledWith({ where: { id: 'pr1' } });
  });
});

// ── SettingsPrismaRepository ───────────────────────────────────────────
describe('SettingsPrismaRepository', () => {
  it('loadAll selects + maps rows', async () => {
    const p = makePrisma();
    m(p, 'serviceSetting').findMany.mockResolvedValue([
      { scope: 'GLOBAL', depotId: null, key: 'k', value: 'v-a' },
    ]);
    const repo = new SettingsPrismaRepository(asService(p));
    await expect(repo.loadAll()).resolves.toEqual([
      { scope: 'GLOBAL', depotId: null, key: 'k', value: 'v-a' },
    ]);
    expect(m(p, 'serviceSetting').findMany).toHaveBeenCalledWith({
      select: { scope: true, depotId: true, key: true, value: true },
    });
  });

  it('upsert updates when a matching row exists', async () => {
    const p = makePrisma();
    m(p, 'serviceSetting').findFirst.mockResolvedValue({ id: 'row1' });
    m(p, 'serviceSetting').update.mockResolvedValue({});
    const repo = new SettingsPrismaRepository(asService(p));
    await repo.upsert({ scope: 'DEPOT', depotId: 'd1', key: 'k', value: 'v1', updatedBy: 'hr' });
    expect(m(p, 'serviceSetting').findFirst).toHaveBeenCalledWith({
      where: { scope: 'DEPOT', depotId: 'd1', key: 'k' },
      select: { id: true },
    });
    expect(m(p, 'serviceSetting').update).toHaveBeenCalledWith({
      where: { id: 'row1' },
      data: { value: 'v1', updatedBy: 'hr' },
    });
    expect(m(p, 'serviceSetting').create).not.toHaveBeenCalled();
  });

  it('upsert creates when no row exists', async () => {
    const p = makePrisma();
    m(p, 'serviceSetting').findFirst.mockResolvedValue(null);
    m(p, 'serviceSetting').create.mockResolvedValue({});
    const repo = new SettingsPrismaRepository(asService(p));
    await repo.upsert({ scope: 'GLOBAL', depotId: null, key: 'k', value: 'v2', updatedBy: 'hr' });
    expect(m(p, 'serviceSetting').create).toHaveBeenCalledWith({
      data: { scope: 'GLOBAL', depotId: null, key: 'k', value: 'v2', updatedBy: 'hr' },
    });
    expect(m(p, 'serviceSetting').update).not.toHaveBeenCalled();
  });

  it('remove → deleteMany on the scope/depot/key', async () => {
    const p = makePrisma();
    m(p, 'serviceSetting').deleteMany.mockResolvedValue({ count: 1 });
    const repo = new SettingsPrismaRepository(asService(p));
    await repo.remove('DEPOT', 'd1', 'k');
    expect(m(p, 'serviceSetting').deleteMany).toHaveBeenCalledWith({
      where: { scope: 'DEPOT', depotId: 'd1', key: 'k' },
    });
  });
});

// ── PrismaService lifecycle ────────────────────────────────────────────
describe('PrismaService', () => {
  it('onModuleInit connects and logs', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await svc.onModuleInit();
    expect(connect).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Connected to PostgreSQL');
    connect.mockRestore();
    log.mockRestore();
  });

  it('onModuleDestroy disconnects', async () => {
    const svc = new PrismaService();
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined);
    await svc.onModuleDestroy();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });
});
