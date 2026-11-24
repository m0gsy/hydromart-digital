import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MAX_AI_READ_GROUPS } from '../../src/application/ports/ai-read.repository';
import { AiReadPrismaRepository } from '../../src/infrastructure/prisma/ai-read.prisma.repository';
import { AiReadInternalController } from '../../src/modules/ai-read-internal.controller';
import { AiAttendanceQueryDto, AiMonthQueryDto } from '../../src/modules/dto/ai-read.dto';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

function setup() {
  const prisma = {
    attendance: { groupBy: jest.fn() },
    attendanceMonthRollup: { count: jest.fn().mockResolvedValue(0) },
    loan: { findMany: jest.fn() },
    payrollItem: { groupBy: jest.fn() },
    $queryRaw: jest.fn(),
  };
  return { prisma, repo: new AiReadPrismaRepository(prisma as never) };
}

describe('AiReadPrismaRepository.attendance (HD-6 H5)', () => {
  it('counts statuses per depot and distinct people, with a row for a depot that has no record', async () => {
    const { prisma, repo } = setup();
    prisma.attendance.groupBy.mockResolvedValue([
      { depotId: D1, employeeId: 'e1', status: 'PRESENT', _count: { _all: 10 } },
      { depotId: D1, employeeId: 'e1', status: 'LATE', _count: { _all: 2 } },
      { depotId: D1, employeeId: 'e2', status: 'PRESENT', _count: { _all: 8 } },
      { depotId: D1, employeeId: 'e2', status: 'ABSENT', _count: { _all: 1 } },
      { depotId: D1, employeeId: 'e3', status: 'LEAVE', _count: { _all: 3 } },
      { depotId: D1, employeeId: 'e3', status: 'PENDING', _count: { _all: 1 } },
      { depotId: D1, employeeId: 'e3', status: 'HOLIDAY', _count: { _all: 4 } },
      { depotId: null, employeeId: 'e4', status: 'PRESENT', _count: { _all: 9 } },
      { depotId: 'unasked', employeeId: 'e5', status: 'PRESENT', _count: { _all: 9 } },
    ]);
    const out = await repo.attendance([D1, D2], '2026-11-01', '2026-11-30');
    expect(out).toEqual({
      rolledUp: false,
      rows: [
        { depotId: D1, present: 18, late: 2, absent: 1, leave: 3, pending: 1, people: 3 },
        { depotId: D2, present: 0, late: 0, absent: 0, leave: 0, pending: 0, people: 0 },
      ],
    });
    const where = prisma.attendance.groupBy.mock.calls[0][0].where;
    expect(where.workDate).toEqual({ gte: new Date('2026-11-01T00:00:00Z'), lte: new Date('2026-11-30T00:00:00Z') });
    expect(prisma.attendanceMonthRollup.count).toHaveBeenCalledWith({
      where: { depotId: { in: [D1, D2] }, month: { gte: '2026-11', lte: '2026-11' } },
    });
  });

  it('says the window is incomplete when leavers days were folded into monthly counts', async () => {
    const { prisma, repo } = setup();
    prisma.attendance.groupBy.mockResolvedValue([]);
    prisma.attendanceMonthRollup.count.mockResolvedValue(2);
    expect((await repo.attendance([D1], '2026-10-15', '2026-11-15')).rolledUp).toBe(true);
  });

  it('refuses a window of more groups than it will count, rather than cutting it', async () => {
    const { prisma, repo } = setup();
    prisma.attendance.groupBy.mockResolvedValue(new Array(MAX_AI_READ_GROUPS + 1).fill({ depotId: D1, employeeId: 'e', status: 'PRESENT', _count: { _all: 1 } }));
    await expect(repo.attendance([D1], '2026-11-01', '2026-11-30')).rejects.toBeInstanceOf(UnprocessableEntityException);
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
      kasbon: jest.fn().mockResolvedValue([]),
    };
    const c = new AiReadInternalController(repo as never);
    await c.attendance({ depotIds: [D1], from: '2026-11-01', to: '2026-11-30' });
    await c.payroll({ depotIds: [D1], month: '2026-11' });
    await c.kasbon({ depotIds: [D1], month: '2026-11' });
    expect(repo.attendance).toHaveBeenCalledWith([D1], '2026-11-01', '2026-11-30');
    expect(repo.payroll).toHaveBeenCalledWith([D1], '2026-11');
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
    const month = (m: string) => validate(plainToInstance(AiMonthQueryDto, { depotIds: D1, month: m }) as object);
    expect(await month('2026-11')).toHaveLength(0);
    expect(await month('2026-13')).not.toHaveLength(0);
    expect(await validate(plainToInstance(AiMonthQueryDto, { depotIds: [D1], month: '2026-11' }) as object)).toHaveLength(0);
  });
});
