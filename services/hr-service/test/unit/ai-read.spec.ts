import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DAILY_GALLON_BONUS_LABEL } from '../../src/domain/daily-sales-bonus';
import { MAX_AI_READ_GROUPS } from '../../src/application/ports/ai-read.repository';
import { AiReadPrismaRepository } from '../../src/infrastructure/prisma/ai-read.prisma.repository';
import { AiReadInternalController } from '../../src/modules/ai-read-internal.controller';
import { AiAttendanceQueryDto, AiMonthQueryDto } from '../../src/modules/dto/ai-read.dto';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

function setup() {
  const prisma = {
    attendance: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
    shiftAssignment: { findMany: jest.fn() },
    shiftRotation: { findMany: jest.fn() },
    holiday: { findMany: jest.fn() },
    attendanceMonthRollup: { count: jest.fn().mockResolvedValue(0) },
    loan: { findMany: jest.fn() },
    payrollItem: { groupBy: jest.fn() },
    $queryRaw: jest.fn(),
  };
  // the depot rest day is Sunday unless a test says otherwise (HR_WEEKLY_OFF_DAYS)
  const off = jest.fn((_depotId: string | null) => '0');
  return { prisma, off, repo: new AiReadPrismaRepository(prisma as never, { weeklyOffDays: off }) };
}

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const emp = (id: string, depotId: string | null, joinDate: string, o: Record<string, unknown> = {}) => ({ id, depotId, joinDate: day(joinDate), exitDate: null, shiftId: null, ...o });
const rec = (employeeId: string, workDate: string, status: string, depotId: string | null = D1) => ({ employeeId, workDate: day(workDate), depotId, status });

/** What the reads of attendance() return, keyed on the shape of each call. */
function seed(prisma: ReturnType<typeof setup>['prisma'], d: { staff: ReturnType<typeof emp>[]; records: ReturnType<typeof rec>[]; assignments?: unknown[]; rotations?: unknown[]; holidays?: unknown[] }) {
  prisma.attendance.findMany.mockImplementation(async (args: { distinct?: string[] }) =>
    args.distinct ? [...new Set(d.records.filter((r) => r.depotId === D1).map((r) => r.employeeId))].map((employeeId) => ({ employeeId })) : d.records,
  );
  prisma.employee.findMany.mockImplementation(async (args: { where: { id?: unknown } }) => (args.where.id ? d.staff : d.staff.filter((e) => e.depotId === D1).map((e) => ({ id: e.id }))));
  prisma.shiftAssignment.findMany.mockResolvedValue(d.assignments ?? []);
  prisma.shiftRotation.findMany.mockResolvedValue(d.rotations ?? []);
  prisma.holiday.findMany.mockResolvedValue(d.holidays ?? []);
}

describe('AiReadPrismaRepository.attendance (HD-6 H5, H-02 choice 35A)', () => {
  const MON_FRI = { 0: null, 1: 'S', 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: null };

  it('counts statuses as before and adds the scheduled days by the rule payroll uses, apart from the unscheduled', async () => {
    const { prisma, repo } = setup();
    seed(prisma, {
      // 1-7 Nov 2026 is Sun..Sat; 4 Nov (Wed) is a national holiday
      staff: [
        emp('e1', D1, '2026-01-01'), // a Mon-Fri rotation: 2, 3, 5, 6 Nov are workdays
        emp('e2', D1, '2026-01-01'), // no shift of their own: the depot rest day is Sunday, so 2, 3, 5, 6, 7 Nov are unscheduled
        emp('e3', D1, '2026-11-05', { shiftId: 's1' }), // joined Thursday 5 Nov on a fixed shift: 5, 6, 7 Nov
        emp('e4', D1, '2026-01-01', { exitDate: day('2026-11-03'), shiftId: 's1' }), // left Tue 3 Nov: 2, 3 Nov
      ],
      records: [
        rec('e1', '2026-11-02', 'PRESENT'),
        rec('e1', '2026-11-03', 'LATE'),
        rec('e1', '2026-11-05', 'LEAVE'),
        rec('e2', '2026-11-02', 'PENDING'),
        rec('e4', '2026-11-02', 'PRESENT', D2), // worked at D2 that day: that day belongs to D2
        rec('e4', '2026-11-03', 'ABSENT'),
        rec('e5', '2026-11-04', 'PRESENT', null), // no depot: counts nowhere
        rec('e6', '2026-11-04', 'HOLIDAY'),
      ],
      assignments: [{ employeeId: 'e1', shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-06-01') }],
      rotations: [{ id: 'r1', pattern: MON_FRI }],
      holidays: [
        { date: day('2026-11-04'), depotId: null },
        { date: day('2026-11-06'), depotId: D2 }, // another depot's holiday does not apply here
      ],
    });
    const out = await repo.attendance([D1, D2], '2026-11-01', '2026-11-07');
    const stub = (id: string, o: Record<string, number>) => ({ depotId: id, present: 0, late: 0, absentRecorded: 0, leave: 0, pending: 0, scheduledDays: 0, attendedScheduled: 0, absentScheduled: 0, unscheduledDays: 0, ...o });
    expect(out.rows).toEqual([
      // e1: 4 scheduled (attended 2, leave 1, absent 6 Nov); e3: 3 scheduled, all absent; e4: 3 Nov only (2 Nov is D2's), explicit ABSENT; e2: 5 unscheduled
      stub(D1, { present: 1, late: 1, absentRecorded: 1, leave: 1, pending: 1, scheduledDays: 8, attendedScheduled: 2, absentScheduled: 5, unscheduledDays: 5 }),
      stub(D2, { present: 1, scheduledDays: 1, attendedScheduled: 1 }),
    ]);
    expect(out.heads).toEqual({
      present: ['e1', 'e4'],
      late: ['e1'],
      absentRecorded: ['e4'],
      leave: ['e1'],
      pending: ['e2'],
      scheduledDays: ['e1', 'e3', 'e4'],
      attendedScheduled: ['e1', 'e4'],
      absentScheduled: ['e1', 'e3', 'e4'],
      unscheduledDays: ['e2'],
    });
    expect(out.rolledUp).toBe(false);
    // the window is read as calendar days, both ends included; the rolled-up months are asked for the depots
    const where = prisma.attendance.findMany.mock.calls[0][0].where;
    expect(where.workDate).toEqual({ gte: day('2026-11-01'), lte: day('2026-11-07') });
    expect(prisma.attendanceMonthRollup.count).toHaveBeenCalledWith({ where: { depotId: { in: [D1, D2] }, month: { gte: '2026-11', lte: '2026-11' } } });
  });

  it('reads the weekly-off days of the depot the employee belongs to', async () => {
    const { prisma, repo, off } = setup();
    off.mockImplementation((depotId: string | null) => (depotId === D1 ? '0,6' : ''));
    seed(prisma, { staff: [emp('e1', D1, '2026-01-01', { shiftId: 's1' })], records: [] });
    const out = await repo.attendance([D1], '2026-11-01', '2026-11-07');
    expect(out.rows[0].scheduledDays).toBe(5); // Mon-Fri
    expect(off).toHaveBeenCalledWith(D1);
  });

  it('puts a scheduled day at the depot worked, and counts one employee once across two depots', async () => {
    const { prisma, repo } = setup();
    seed(prisma, {
      staff: [emp('e1', D1, '2026-01-01', { shiftId: 's1' })],
      records: [rec('e1', '2026-11-02', 'LEAVE', D1), rec('e1', '2026-11-03', 'LEAVE', D2)],
    });
    const out = await repo.attendance([D1, D2], '2026-11-02', '2026-11-03');
    expect(out.heads.leave).toEqual(['e1']);
    expect(out.rows.map((r) => [r.leave, r.scheduledDays, r.absentScheduled])).toEqual([[1, 1, 0], [1, 1, 0]]);
  });

  it('follows the assignment in force on each day, and a fixed-shift assignment rests on the depot days', async () => {
    const { prisma, repo } = setup();
    seed(prisma, {
      staff: [emp('e1', D1, '2026-01-01')],
      records: [],
      assignments: [
        { employeeId: 'e1', shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-11-01') },
        { employeeId: 'e1', shiftId: 's1', rotationId: null, effectiveFrom: day('2026-11-04') },
      ],
      rotations: [{ id: 'r1', pattern: { 1: 'S' } }], // Mondays only
    });
    // 2 Nov (Mon) on the rotation; from 4 Nov a fixed shift, the depot rests Sunday: 4, 5, 6, 7 Nov
    expect((await repo.attendance([D1], '2026-11-01', '2026-11-07')).rows[0].scheduledDays).toBe(5);
  });

  it('treats a rotation that was deleted like no rotation, and an employee with nothing as unscheduled', async () => {
    const { prisma, repo } = setup();
    seed(prisma, {
      staff: [emp('e1', D1, '2026-01-01')],
      records: [],
      assignments: [{ employeeId: 'e1', shiftId: null, rotationId: 'gone', effectiveFrom: day('2026-01-01') }],
    });
    const out = await repo.attendance([D1], '2026-11-02', '2026-11-03');
    expect(out.rows[0]).toMatchObject({ scheduledDays: 0, unscheduledDays: 2 });
  });

  it('says the window is incomplete when leavers days were folded into monthly counts', async () => {
    const { prisma, repo } = setup();
    seed(prisma, { staff: [], records: [] });
    prisma.attendanceMonthRollup.count.mockResolvedValue(2);
    expect((await repo.attendance([D1], '2026-10-15', '2026-11-15')).rolledUp).toBe(true);
  });

  it('refuses a window of more people or records than it will count, rather than cutting it', async () => {
    const { prisma, repo } = setup();
    seed(prisma, { staff: [], records: [] });
    prisma.attendance.findMany.mockResolvedValue(new Array(MAX_AI_READ_GROUPS + 1).fill({ employeeId: 'e' }));
    await expect(repo.attendance([D1], '2026-11-01', '2026-11-30')).rejects.toBeInstanceOf(UnprocessableEntityException);
    seed(prisma, { staff: [], records: [] });
    prisma.employee.findMany.mockResolvedValue(new Array(MAX_AI_READ_GROUPS + 1).fill({ id: 'e' }));
    await expect(repo.attendance([D1], '2026-11-01', '2026-11-30')).rejects.toBeInstanceOf(UnprocessableEntityException);
    // more distinct people than the cap across the two lists
    prisma.attendance.findMany.mockResolvedValue(Array.from({ length: MAX_AI_READ_GROUPS }, (_, i) => ({ employeeId: `a${i}` })));
    prisma.employee.findMany.mockResolvedValue([{ id: 'b' }]);
    await expect(repo.attendance([D1], '2026-11-01', '2026-11-30')).rejects.toBeInstanceOf(UnprocessableEntityException);
    // too many records for one answer
    prisma.attendance.findMany.mockImplementation(async (args: { distinct?: string[] }) => (args.distinct ? [{ employeeId: 'e1' }] : new Array(250_001).fill(rec('e1', '2026-11-02', 'PRESENT'))));
    prisma.employee.findMany.mockResolvedValue([{ id: 'e1' }]);
    await expect(repo.attendance([D1], '2026-11-01', '2026-11-30')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('AiReadPrismaRepository.payrollGate (HD-6 H5)', () => {
  it('reads who the month waits for and what is finished by the HOME depot, one row per depot', async () => {
    const { prisma, repo } = setup();
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('"n"') ? [{ depotId: D1, n: 4n }] : [{ depotId: D1, draft: 1n, final: 3n }],
    );
    expect(await repo.payrollGate([D1, D2], '2026-11')).toEqual([
      { depotId: D1, expected: 4, draft: 1, final: 3 },
      { depotId: D2, expected: 0, draft: 0, final: 0 },
    ]);
    for (const call of prisma.$queryRaw.mock.calls) {
      expect((call[0] as TemplateStringsArray).join('?')).toContain('COALESCE(e."homeDepotId", e."depotId")');
    }
  });
});

describe('AiReadPrismaRepository.payroll (HD-6 H5)', () => {
  it('answers one row per depot asked for, zeros where the depot has no finished slip', async () => {
    const { prisma, repo } = setup();
    prisma.$queryRaw.mockResolvedValue([
      { depotId: D1, slips: 3n, gross: '9000000', bonus: '500000', deduction: '200000', net: '9300000', gallon: '120000', gallonPeople: 2n },
    ]);
    expect(await repo.payroll([D1, D2], '2026-11')).toEqual([
      { depotId: D1, slips: 3, grossIdr: 9000000, bonusIdr: 500000, deductionIdr: 200000, netIdr: 9300000, gallonBonusIdr: 120000, gallonPeople: 2 },
      { depotId: D2, slips: 0, grossIdr: 0, bonusIdr: 0, deductionIdr: 0, netIdr: 0, gallonBonusIdr: 0, gallonPeople: 0 },
    ]);
    // A month, only the finished slips, and the ids as typed uuids: no value is spliced into the SQL.
    const strings = prisma.$queryRaw.mock.calls[0][0].join('?');
    expect(strings).toContain(`p."status" IN ('APPROVED', 'PAID')`);
    expect(strings).toContain(`"kind" = 'BONUS'`);
    // by the employee's HOME depot, the basis of the finished-month gate too
    expect(strings).toContain('COALESCE(e."homeDepotId", e."depotId")');
    // the gallon line is found by the label the payroll writer uses
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain(`${DAILY_GALLON_BONUS_LABEL} (%`);
  });

  it('reads null sums as 0', async () => {
    const { prisma, repo } = setup();
    prisma.$queryRaw.mockResolvedValue([{ depotId: D1, slips: 1n, gross: null, bonus: null, deduction: null, net: null, gallon: null, gallonPeople: null }]);
    expect((await repo.payroll([D1], '2026-11'))[0]).toEqual({ depotId: D1, slips: 1, grossIdr: 0, bonusIdr: 0, deductionIdr: 0, netIdr: 0, gallonBonusIdr: 0, gallonPeople: 0 });
  });
});

describe('AiReadPrismaRepository.kasbon (HD-6 H5)', () => {
  const loan = (id: string, employeeId: string, depotId: string | null, principal: number, installment: number, startPeriod = '2026-09') => ({
    id,
    employeeId,
    principal,
    installmentAmount: installment,
    startPeriod,
    employee: { depotId },
  });

  it('is what is still owed on the slips that count, with the people who owe it', async () => {
    const { prisma, repo } = setup();
    prisma.loan.findMany.mockResolvedValue([
      loan('l1', 'e1', D1, 3_000_000, 1_000_000), // 3 installments elapsed by 2026-11, 2 actually taken => 1.000.000 left
      loan('l2', 'e1', D1, 1_000_000, 500_000, '2026-10'), // second loan, nothing taken yet, same person: one head
      loan('l3', 'e2', D1, 600_000, 300_000, '2026-10'), // fully paid by two slips
      loan('l4', 'e3', null, 900_000, 100_000), // a person above any depot: not in any depot's number
    ]);
    prisma.payrollItem.groupBy.mockResolvedValue([
      { sourceRef: 'l1', _sum: { amount: '2000000' } },
      { sourceRef: 'l3', _sum: { amount: '600000' } },
      { sourceRef: 'l2', _sum: { amount: null } },
    ]);
    expect(await repo.kasbon([D1, D2], '2026-11')).toEqual([
      { depotId: D1, people: 1, remainingIdr: 1_000_000 + 1_000_000 },
      { depotId: D2, people: 0, remainingIdr: 0 },
    ]);
  });

  it('counts only APPROVED/PAID slips up to the month when asking what was paid, in batches', async () => {
    const { prisma, repo } = setup();
    prisma.loan.findMany.mockResolvedValue(Array.from({ length: 5001 }, (_, i) => loan(`l${i}`, `e${i}`, D1, 100, 50)));
    prisma.payrollItem.groupBy.mockResolvedValue([]);
    const out = await repo.kasbon([D1], '2026-11');
    expect(prisma.payrollItem.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.payrollItem.groupBy.mock.calls[0][0].where.payroll).toEqual({
      periodMonth: { lte: '2026-11' },
      status: { in: ['APPROVED', 'PAID'] },
    });
    expect(out[0]).toEqual({ depotId: D1, people: 5001, remainingIdr: 500_100 });
  });

  it('reads a lent employee at the home depot: homeDepotId first, the live depot only when there is none', async () => {
    const { prisma, repo } = setup();
    prisma.loan.findMany.mockResolvedValue([
      { ...loan('l1', 'e1', D2, 1000, 500), employee: { depotId: D2, homeDepotId: D1 } }, // lent to D2, belongs to D1
      { ...loan('l2', 'e2', D2, 1000, 500), employee: { depotId: D2, homeDepotId: null } },
    ]);
    prisma.payrollItem.groupBy.mockResolvedValue([]);
    expect(await repo.kasbon([D1, D2], '2026-11')).toEqual([
      { depotId: D1, people: 1, remainingIdr: 1000 },
      { depotId: D2, people: 1, remainingIdr: 1000 },
    ]);
    expect(prisma.loan.findMany.mock.calls[0][0].where.employee).toEqual({
      OR: [{ homeDepotId: { in: [D1, D2] } }, { homeDepotId: null, depotId: { in: [D1, D2] } }],
    });
  });

  it('refuses more loans than it will walk, rather than cutting the list', async () => {
    const { prisma, repo } = setup();
    prisma.loan.findMany.mockResolvedValue(new Array(MAX_AI_READ_GROUPS + 1).fill(loan('l', 'e', D1, 1, 1)));
    await expect(repo.kasbon([D1], '2026-11')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('AiReadInternalController and its DTOs (HD-6 H5)', () => {
  it('hands the depots and the window to the repository', async () => {
    const repo = {
      attendance: jest.fn().mockResolvedValue({ rows: [], rolledUp: false }),
      payroll: jest.fn().mockResolvedValue([]),
      payrollGate: jest.fn().mockResolvedValue([]),
      kasbon: jest.fn().mockResolvedValue([]),
    };
    const c = new AiReadInternalController(repo as never);
    await c.attendance({ depotIds: [D1], from: '2026-11-01', to: '2026-11-30' });
    await c.payroll({ depotIds: [D1], month: '2026-11' });
    await c.payrollGate({ depotIds: [D1], month: '2026-11' });
    await c.kasbon({ depotIds: [D1], month: '2026-11' });
    expect(repo.attendance).toHaveBeenCalledWith([D1], '2026-11-01', '2026-11-30');
    expect(repo.payroll).toHaveBeenCalledWith([D1], '2026-11');
    expect(repo.payrollGate).toHaveBeenCalledWith([D1], '2026-11');
    expect(repo.kasbon).toHaveBeenCalledWith([D1], '2026-11');
  });

  it('takes 1 to 100 depot ids, an ordered window of at most 366 days, and a real month', async () => {
    const att = (body: object) => validate(plainToInstance(AiAttendanceQueryDto, body) as object);
    expect(await att({ depotIds: `${D1}, ${D2}`, from: '2026-11-01', to: '2026-11-30' })).toHaveLength(0);
    expect(await att({ depotIds: '', from: '2026-11-01', to: '2026-11-30' })).not.toHaveLength(0);
    expect(await att({ depotIds: 'x', from: '2026-11-01', to: '2026-11-30' })).not.toHaveLength(0);
    expect(await att({ depotIds: D1, from: '2026-11-30', to: '2026-11-01' })).not.toHaveLength(0);
    expect(await att({ depotIds: D1, from: '2025-01-01', to: '2026-11-01' })).not.toHaveLength(0);
    expect(await att({ depotIds: new Array(101).fill(D1).join(','), from: '2026-11-01', to: '2026-11-30' })).not.toHaveLength(0);
    // a real calendar day: 2026-02-31 is a 400, not a 500 from the database
    expect(await att({ depotIds: D1, from: '2026-02-31', to: '2026-03-02' })).not.toHaveLength(0);
    expect(await att({ depotIds: D1, from: '2026-02-01', to: '2026-02-30' })).not.toHaveLength(0);
    expect(await att({ depotIds: D1, from: '2026-02-28', to: '2026-03-01' })).toHaveLength(0);
    const month = (m: string) => validate(plainToInstance(AiMonthQueryDto, { depotIds: D1, month: m }) as object);
    expect(await month('2026-11')).toHaveLength(0);
    expect(await month('2026-13')).not.toHaveLength(0);
    expect(await validate(plainToInstance(AiMonthQueryDto, { depotIds: [D1], month: '2026-11' }) as object)).toHaveLength(0);
  });
});
