import { OutboxPrismaRepository } from '../../src/infrastructure/prisma/outbox.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// H-10: the durable half of the completion fan-out. These pin the exact prisma calls —
// a claim that ignored the backoff would hammer a downed service, and a markFailed that
// forgot to flip DEAD would leave a stock consume nobody is coming for looking PENDING
// forever.
describe('OutboxPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
  };
  const repo = new OutboxPrismaRepository({ outboxMessage: model } as unknown as PrismaService);

  const row = {
    id: 'ob-1',
    topic: 'INVENTORY_CONSUME',
    orderId: 'ord-1',
    status: 'PENDING',
    attempts: 2,
    nextAttemptAt: new Date('2026-08-03T10:00:00Z'),
    lastError: 'depot-service down',
    createdAt: new Date('2026-08-03T09:00:00Z'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('ORD-12: reads the due rows of ONE order, in the query rather than in memory', async () => {
    model.findMany.mockResolvedValue([row]);
    const now = new Date('2026-08-03T11:00:00Z');
    const out = await repo.findDueForOrder('ord-1', now, 50);

    expect(out[0]).toMatchObject({ id: 'ob-1', orderId: 'ord-1' });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { orderId: 'ord-1', status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });
  });

  it('claims only PENDING rows whose backoff has elapsed, oldest first', async () => {
    model.findMany.mockResolvedValue([row]);
    const now = new Date('2026-08-03T11:00:00Z');
    const out = await repo.findDue(now, 50);

    expect(out[0]).toMatchObject({ id: 'ob-1', topic: 'INVENTORY_CONSUME', attempts: 2 });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });
  });

  // HD-6: a void cancels what the sale still owed, but never the rows the VOID itself owes.
  it('cancels a voided sale pending rows except the ones the void owes', async () => {
    model.updateMany.mockResolvedValue({ count: 2 });
    await expect(repo.cancelForOrder('ord-1', 'Salah')).resolves.toBe(2);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'ord-1',
        status: 'PENDING',
        topic: {
          notIn: [
            'PAYMENT_REVERSAL',
            'FRANCHISE_REVENUE_VOID',
            'REFERRAL_REVERSE',
            'GALLON_ISSUE_VOID',
          ],
        },
      },
      data: { status: 'CANCELLED', lastError: 'Salah' },
    });
  });

  it('re-arms the one row of a topic and order instead of duplicating it', async () => {
    const upsert = jest.fn();
    const r = new OutboxPrismaRepository({ outboxMessage: { upsert } } as unknown as PrismaService);
    await r.requeue('GALLON_ISSUE_VOID', 'ord-1');
    expect(upsert).toHaveBeenCalledWith({
      where: { topic_orderId: { topic: 'GALLON_ISSUE_VOID', orderId: 'ord-1' } },
      create: { topic: 'GALLON_ISSUE_VOID', orderId: 'ord-1' },
      update: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('closes a delivered row and clears the last error', async () => {
    await repo.markDone('ob-1');
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'ob-1', status: 'PENDING' },
      data: { status: 'DONE', lastError: null },
    });
  });

  it('schedules the next attempt when retries remain', async () => {
    const retryAt = new Date('2026-08-03T12:00:00Z');
    await repo.markFailed('ob-1', 'depot-service down', retryAt);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'ob-1', status: 'PENDING' },
      data: {
        status: 'PENDING',
        attempts: { increment: 1 },
        lastError: 'depot-service down',
        nextAttemptAt: retryAt,
      },
    });
  });

  it('marks the row DEAD when there is no next attempt, and truncates the reason', async () => {
    await repo.markFailed('ob-1', 'x'.repeat(900), null);
    const data = model.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('DEAD');
    expect(data.nextAttemptAt).toBeUndefined();
    // A stack trace in a TEXT column nobody reads is not worth the row size.
    expect(data.lastError).toHaveLength(500);
  });

  it('counts every status, including the ones with no rows', async () => {
    model.groupBy.mockResolvedValue([{ status: 'PENDING', _count: { _all: 3 } }]);
    await expect(repo.countByStatus()).resolves.toEqual({
      PENDING: 3,
      DONE: 0,
      DEAD: 0,
      CANCELLED: 0,
    });
  });

  // Owner decision 2026-11-21: head office may not change who owns a depot while any of its
  // franchise revenue is still owed — a retried credit could pay the new owner.
  describe('countPendingRevenue', () => {
    const queryRaw = jest.fn();
    const withSql = new OutboxPrismaRepository({
      outboxMessage: model,
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    it('counts the owed credits and voids of that depot in one joined query, with no cap', async () => {
      queryRaw.mockResolvedValueOnce([{ n: BigInt(3) }]);
      await expect(withSql.countPendingRevenue('dep-1')).resolves.toBe(3);
      const sql = queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
      const text = sql.strings.join('?');
      expect(text).toContain('JOIN "orders"');
      expect(text).toContain("'FRANCHISE_REVENUE', 'FRANCHISE_REVENUE_VOID'");
      expect(text).not.toMatch(/LIMIT/i);
      expect(sql.values).toEqual(['dep-1']);
    });

    it('an empty answer is nothing owed', async () => {
      queryRaw.mockResolvedValueOnce([]);
      await expect(withSql.countPendingRevenue('dep-1')).resolves.toBe(0);
    });
  });
});
