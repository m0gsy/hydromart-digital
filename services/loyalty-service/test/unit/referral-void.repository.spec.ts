import { LoyaltyPrismaRepository } from '../../src/infrastructure/prisma/loyalty.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const key = 'referral:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:referrer';

function setup(pointsBalance = 100, grantPoints?: number, grantType = 'REWARD') {
  const account = {
    id: 'account-1', customerId: 'customer-1', tier: 'REGULAR', pointsBalance,
    lifetimePoints: 500, createdAt: new Date(), updatedAt: new Date(),
  };
  const transactions = new Map<string, { type: string; points: number; uncollectedPoints: number }>();
  if (grantPoints !== undefined) transactions.set(key, { type: grantType, points: grantPoints, uncollectedPoints: 0 });
  const tx = {
    $queryRaw: jest.fn(async () => [{ pointsBalance: account.pointsBalance, lifetimePoints: account.lifetimePoints }]),
    pointsTransaction: {
      findUnique: jest.fn(async ({ where }: { where: { customerId_idempotencyKey: { idempotencyKey: string } } }) =>
        transactions.get(where.customerId_idempotencyKey.idempotencyKey) ?? null),
      create: jest.fn(async ({ data }: { data: { idempotencyKey: string; type: string; points: number; uncollectedPoints?: number } }) => {
        transactions.set(data.idempotencyKey, { type: data.type, points: data.points, uncollectedPoints: data.uncollectedPoints ?? 0 });
      }),
    },
    loyaltyAccount: { findUniqueOrThrow: jest.fn(async () => ({ ...account })) },
    $executeRaw: jest.fn(async (_sql: TemplateStringsArray, deducted: number, granted: number) => {
      account.pointsBalance -= deducted;
      account.lifetimePoints = Math.max(0, account.lifetimePoints - granted);
    }),
  };
  const prisma = { $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
  const repo = new LoyaltyPrismaRepository(prisma as unknown as PrismaService);
  jest.spyOn(repo, 'createAccount').mockResolvedValue(account as never);
  return { repo, prisma, tx, account, transactions };
}

describe('referral reward reversal repository', () => {
  it('debits available points, records spent shortfall and stays idempotent', async () => {
    const { repo, account, transactions, tx } = setup(100, 500);
    expect(await repo.reverseReward('customer-1', key)).toMatchObject({ uncollected: 400, account: { pointsBalance: 0 } });
    expect(account.lifetimePoints).toBe(0);
    expect(transactions.get(`void:${key}`)).toMatchObject({ type: 'ADJUST', points: -100, uncollectedPoints: 400 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(await repo.reverseReward('customer-1', key)).toMatchObject({ uncollected: 400, account: { pointsBalance: 0 } });
    expect(tx.pointsTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('creates a zero-point tombstone for a reward that has not landed', async () => {
    const { repo, transactions, tx } = setup();
    expect(await repo.reverseReward('customer-1', key)).toMatchObject({ uncollected: 0 });
    expect(transactions.get(key)).toMatchObject({ type: 'ADJUST', points: 0 });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(await repo.reverseReward('customer-1', key)).toMatchObject({ uncollected: 0 });
    expect(tx.pointsTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('does not reverse an unrelated transaction under the reward key', async () => {
    const { repo, tx } = setup(100, 50, 'ADJUST');
    expect(await repo.reverseReward('customer-1', key)).toMatchObject({ uncollected: 0 });
    expect(tx.pointsTransaction.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('retries unique and serialization races, but propagates other failures', async () => {
    const { repo, prisma } = setup(500, 500);
    const run = prisma.$transaction.getMockImplementation()!;
    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('race'), { code: 'P2002' }))
      .mockRejectedValueOnce(Object.assign(new Error('serialize'), { code: 'P2034' }))
      .mockImplementation(run);
    expect(await repo.reverseReward('customer-1', key)).toMatchObject({ uncollected: 0, account: { pointsBalance: 0 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);

    const failed = setup(100, 500);
    failed.prisma.$transaction.mockRejectedValue(new Error('database down'));
    await expect(failed.repo.reverseReward('customer-1', key)).rejects.toThrow('database down');
    expect(failed.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('stops after three serialization failures', async () => {
    const { repo, prisma } = setup(100, 500);
    prisma.$transaction.mockRejectedValue(Object.assign(new Error('serialize'), { code: 'P2034' }));
    await expect(repo.reverseReward('customer-1', key)).rejects.toThrow('serialize');
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
