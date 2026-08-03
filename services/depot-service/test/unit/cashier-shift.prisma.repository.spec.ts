import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CashierShiftPrismaRepository } from '../../src/infrastructure/prisma/cashier-shift.prisma.repository';
import { CashierShiftStatus } from '../../src/domain/cashier-shift';
import { ShiftAlreadyOpenError } from '../../src/domain/errors';

// Query shape + row mapping against a mocked Prisma delegate. No DB.

const row = (over: Record<string, unknown> = {}) => ({
  id: 'shift-1',
  depotId: 'depot-1',
  cashierId: 'cashier-1',
  cashierName: '0812',
  status: 'OPEN',
  openingFloat: 200_000,
  openedAt: new Date('2026-08-03T01:00:00Z'),
  closedAt: null,
  countedCash: null,
  expectedCash: null,
  variance: null,
  note: null,
  ...over,
});

function repoWith(cashierShift: Record<string, jest.Mock>): CashierShiftPrismaRepository {
  return new CashierShiftPrismaRepository({ cashierShift } as unknown as PrismaService);
}

describe('CashierShiftPrismaRepository', () => {
  it('opens a shift and maps the row', async () => {
    const create = jest.fn().mockResolvedValue(row());
    const shift = await repoWith({ create }).open({
      depotId: 'depot-1',
      cashierId: 'cashier-1',
      cashierName: '0812',
      openingFloat: 200_000,
    });
    expect(shift.status).toBe(CashierShiftStatus.OPEN);
    expect(shift.openingFloat).toBe(200_000);
  });

  // The partial unique index is the real guard against two open shifts on one drawer; this
  // turns its raw P2002 into the message the cashier can act on.
  it('translates the unique-index violation into ShiftAlreadyOpen', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    await expect(
      repoWith({ create }).open({
        depotId: 'depot-1',
        cashierId: 'cashier-1',
        cashierName: '0812',
        openingFloat: 0,
      }),
    ).rejects.toBeInstanceOf(ShiftAlreadyOpenError);
  });

  it('rethrows any other write failure untouched', async () => {
    const create = jest.fn().mockRejectedValue(new Error('connection lost'));
    await expect(
      repoWith({ create }).open({
        depotId: 'depot-1',
        cashierId: 'cashier-1',
        cashierName: '0812',
        openingFloat: 0,
      }),
    ).rejects.toThrow('connection lost');
  });

  it('returns null for an unknown id and for a cashier not on the counter', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const findFirst = jest.fn().mockResolvedValue(null);
    const repo = repoWith({ findUnique, findFirst });
    expect(await repo.findById('nope')).toBeNull();
    expect(await repo.findOpen('depot-1', 'cashier-1')).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', cashierId: 'cashier-1', status: CashierShiftStatus.OPEN },
    });
  });

  it('maps the found rows', async () => {
    const repo = repoWith({
      findUnique: jest.fn().mockResolvedValue(row()),
      findFirst: jest.fn().mockResolvedValue(row()),
    });
    expect((await repo.findById('shift-1'))?.id).toBe('shift-1');
    expect((await repo.findOpen('depot-1', 'cashier-1'))?.cashierName).toBe('0812');
  });

  it('lists open shifts oldest first — whoever has been on longest is at the top', async () => {
    const findMany = jest.fn().mockResolvedValue([row()]);
    const list = await repoWith({ findMany }).listOpen('depot-1');
    expect(findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', status: CashierShiftStatus.OPEN },
      orderBy: { openedAt: 'asc' },
    });
    expect(list).toHaveLength(1);
  });

  it('lists closed shifts newest first, capped', async () => {
    const findMany = jest.fn().mockResolvedValue([row({ status: 'CLOSED', closedAt: new Date() })]);
    const list = await repoWith({ findMany }).listClosed('depot-1', 5);
    expect(findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', status: CashierShiftStatus.CLOSED },
      orderBy: { closedAt: 'desc' },
      take: 5,
    });
    expect(list[0].status).toBe(CashierShiftStatus.CLOSED);
  });

  it('stamps CLOSED alongside the counted figures', async () => {
    const closedAt = new Date('2026-08-03T09:00:00Z');
    const update = jest
      .fn()
      .mockResolvedValue(row({ status: 'CLOSED', closedAt, countedCash: 1, expectedCash: 1, variance: 0 }));
    const closed = await repoWith({ update }).close('shift-1', {
      closedAt,
      countedCash: 1,
      expectedCash: 1,
      variance: 0,
      note: null,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'shift-1' },
      data: {
        closedAt,
        countedCash: 1,
        expectedCash: 1,
        variance: 0,
        note: null,
        status: CashierShiftStatus.CLOSED,
      },
    });
    expect(closed.status).toBe(CashierShiftStatus.CLOSED);
  });
});
