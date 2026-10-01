import { MonthlyClosePrismaRepository } from '../../src/infrastructure/prisma/monthly-close.prisma.repository';

describe('MonthlyClosePrismaRepository', () => {
  const row = {
    id: 'mclose-1',
    depotId: 'd1',
    businessMonth: new Date('2026-07-01T00:00:00.000Z'),
    closedAt: new Date('2026-08-01T05:00:00.000Z'),
    closedBy: 'kd-1',
    cashInIdr: 3_000_000,
    cashOutIdr: 500_000,
    konterIdr: 1_800_000,
    codDepositedIdr: 1_200_000,
    codExpectedIdr: 1_250_000,
    daysClosed: 31,
    note: null,
    reopenedAt: null,
    reopenedBy: null,
  };
  const depotMonthlyClose = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    // Declared with its argument like the daily-close fake beside it: a zero-arg `jest.fn`
    // types `mock.calls` as `[][]`, and the assertion below reads calls[0][0].
    upsert: jest.fn(async (_args: unknown) => row),
    update: jest.fn(async () => ({ ...row, reopenedAt: new Date(), reopenedBy: 'hq-1' })),
  };
  const repo = new MonthlyClosePrismaRepository({ depotMonthlyClose } as never);

  beforeEach(() => jest.clearAllMocks());

  it('hands the business month back as the YYYY-MM it was asked with', async () => {
    depotMonthlyClose.findUnique.mockResolvedValue(row);

    await expect(repo.find('d1', '2026-07')).resolves.toMatchObject({
      businessMonth: '2026-07',
      daysClosed: 31,
    });
  });

  it('reports an unsealed month as null', async () => {
    depotMonthlyClose.findUnique.mockResolvedValue(null);
    await expect(repo.find('d1', '2026-07')).resolves.toBeNull();
  });

  // Upsert, so re-sealing a reopened month replaces the snapshot instead of adding a second
  // answer to "what did this depot take".
  it('upserts on (depot, month) and clears the reopen marks', async () => {
    await repo.close({
      depotId: 'd1',
      businessMonth: '2026-07',
      closedBy: 'kd-1',
      cashInIdr: 1,
      cashOutIdr: 2,
      konterIdr: 3,
      codDepositedIdr: 4,
      codExpectedIdr: 5,
      daysClosed: 31,
      note: 'ok',
    });

    const arg = depotMonthlyClose.upsert.mock.calls[0][0] as {
      where: { depotId_businessMonth: { depotId: string } };
      create: { note: string | null };
      update: { reopenedAt: Date | null; reopenedBy: string | null };
    };
    expect(arg.where.depotId_businessMonth.depotId).toBe('d1');
    expect(arg.update.reopenedAt).toBeNull();
    expect(arg.update.reopenedBy).toBeNull();
    expect(arg.create.note).toBe('ok');
  });

  it('marks a reopen rather than deleting the row', async () => {
    const out = await repo.reopen('d1', '2026-07', 'hq-1');
    expect(depotMonthlyClose.update).toHaveBeenCalled();
    expect(out.reopenedBy).toBe('hq-1');
  });

  it('findSealing asks for the sealed (not reopened) row covering that day', async () => {
    depotMonthlyClose.findFirst.mockResolvedValue(row);

    await expect(repo.findSealing('d1', '2026-07-15')).resolves.toMatchObject({
      businessMonth: '2026-07',
    });
    expect(depotMonthlyClose.findFirst).toHaveBeenCalledWith({
      where: { depotId: 'd1', businessMonth: new Date('2026-07-01'), reopenedAt: null },
    });
  });

  it('findSealing reports no seal when none covers that day', async () => {
    depotMonthlyClose.findFirst.mockResolvedValue(null);
    await expect(repo.findSealing('d1', '2026-07-15')).resolves.toBeNull();
  });
});
