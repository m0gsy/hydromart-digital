import { PayrollPrismaRepository } from '../../src/infrastructure/prisma/payroll.prisma.repository';
import { EmployeePrismaRepository } from '../../src/infrastructure/prisma/employee.prisma.repository';

const G = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const share = (depotId: string, gross: number) => ({
  depotId,
  days: 1,
  gross,
  bonus: 0,
  deduction: 0,
  shortfall: 0,
  net: gross,
});
const write = {
  employeeId: 'e1',
  periodMonth: '2026-09',
  gross: 3,
  totalBonus: 0,
  totalDeduction: 0,
  net: 3,
  presentDays: 1,
  createdBy: null,
  items: [],
};

describe('PayrollPrismaRepository writes the per-depot split with the slip', () => {
  function build() {
    const tx = {
      payrollItem: { deleteMany: jest.fn() },
      payrollDepotShare: { deleteMany: jest.fn() },
      payroll: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      payroll: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    return { prisma, tx, repo: new PayrollPrismaRepository(prisma as never) };
  }

  it('create nests the shares in the same statement, and leaves them out when there are none', async () => {
    const { prisma, repo } = build();
    await repo.create({ ...write, shares: [share(G, 2), share(P, 1)] });
    expect(prisma.payroll.create.mock.calls[0][0].data.shares).toEqual({ create: [share(G, 2), share(P, 1)] });
    await repo.create(write);
    expect(prisma.payroll.create.mock.calls[1][0].data).not.toHaveProperty('shares');
    await repo.create({ ...write, shares: [] });
    expect(prisma.payroll.create.mock.calls[2][0].data).not.toHaveProperty('shares');
  });

  it('regenerate replaces the split only when told to (absent leaves it, [] clears it)', async () => {
    const { tx, repo } = build();
    await repo.regenerate('pay_1', { ...write, shares: [share(G, 3)] });
    expect(tx.payrollDepotShare.deleteMany).toHaveBeenCalledWith({ where: { payrollId: 'pay_1' } });
    expect(tx.payroll.update.mock.calls[0][0].data.shares).toEqual({ create: [share(G, 3)] });

    tx.payrollDepotShare.deleteMany.mockClear();
    await repo.regenerate('pay_1', { ...write, shares: [] });
    expect(tx.payrollDepotShare.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.payroll.update.mock.calls[1][0].data).not.toHaveProperty('shares');

    tx.payrollDepotShare.deleteMany.mockClear();
    await repo.regenerate('pay_1', write);
    expect(tx.payrollDepotShare.deleteMany).not.toHaveBeenCalled();
  });
});

describe('EmployeePrismaRepository.list by home depot', () => {
  function list(filter: Record<string, unknown>) {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      employee: { findMany, count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (qs: unknown[]) => Promise.all(qs)),
    };
    return new EmployeePrismaRepository(prisma as never)
      .list({ skip: 0, take: 10, ...filter } as never)
      .then(() => findMany.mock.calls[0][0].where);
  }

  it('matches the depot people belong to, falling back to the live depot for rows without one', async () => {
    const where = await list({ depotIds: [G], byHome: true, search: 'bud' });
    expect(where.AND).toEqual([
      { OR: [{ homeDepotId: { in: [G] } }, { homeDepotId: null, depotId: { in: [G] } }] },
    ]);
    expect(where).not.toHaveProperty('depotId');
    expect(where.OR).toBeDefined(); // the search clause is untouched by the home match
  });

  it('is the live depot as before when byHome is not asked for', async () => {
    const where = await list({ depotIds: [G] });
    expect(where.depotId).toEqual({ in: [G] });
    expect(where).not.toHaveProperty('AND');
  });
});
