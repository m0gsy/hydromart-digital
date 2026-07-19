import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { LoyaltyPrismaRepository } from '../../src/infrastructure/prisma/loyalty.prisma.repository';
import { RewardPrismaRepository } from '../../src/infrastructure/prisma/reward.prisma.repository';
import { MembershipTier } from '../../src/domain/membership';
import { PointsTxnType } from '../../src/domain/points';

// Unit-tests the loyalty-service Prisma repositories against per-model jest.fn() mocks of
// PrismaService. No real database: each test asserts the EXACT prisma call args and the
// points/balance mapping. $transaction is mocked to resolve the array of build-time ops it
// is handed (the repos read positional results out of it). Mirrors
// services/auth-service/test/unit/prisma-repositories.spec.ts.

describe('LoyaltyPrismaRepository', () => {
  const loyaltyAccount = {
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
    update: jest.fn(),
  };
  const pointsTransaction = {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const rewardRedemption = { aggregate: jest.fn() };
  // $transaction receives an array of already-built ops; resolve it as-is so the repo's
  // positional destructuring ([, account]) sees whatever we seed the ops to return.
  const $transaction = jest.fn((ops: unknown) => Promise.resolve(ops));
  const prisma = {
    loyaltyAccount,
    pointsTransaction,
    rewardRedemption,
    $transaction,
  } as unknown as PrismaService;
  const repo = new LoyaltyPrismaRepository(prisma);

  const accountRow = () => ({
    id: 'acc-1',
    customerId: 'cust-1',
    tier: 'GOLD',
    pointsBalance: 1200,
    lifetimePoints: 6000,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  const txnRow = () => ({
    id: 'txn-1',
    customerId: 'cust-1',
    type: 'EARN',
    points: 100,
    orderId: 'ord-1',
    reason: null,
    expiresAt: new Date('2026-07-01'),
    expired: false,
    createdAt: new Date('2026-01-01'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('finds an account and maps the tier enum, null on miss', async () => {
    loyaltyAccount.findUnique.mockResolvedValue(accountRow());
    const out = await repo.findAccount('cust-1');
    expect(out?.tier).toBe(MembershipTier.GOLD);
    expect(out?.pointsBalance).toBe(1200);
    expect(loyaltyAccount.findUnique).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });

    loyaltyAccount.findUnique.mockResolvedValue(null);
    expect(await repo.findAccount('nope')).toBeNull();
  });

  it('creates a bare account', async () => {
    loyaltyAccount.create.mockResolvedValue(accountRow());
    const out = await repo.createAccount('cust-1');
    expect(out.tier).toBe(MembershipTier.GOLD);
    expect(loyaltyAccount.create).toHaveBeenCalledWith({ data: { customerId: 'cust-1' } });
  });

  it('counts all accounts', async () => {
    loyaltyAccount.count.mockResolvedValue(9);
    expect(await repo.countAccounts()).toBe(9);
  });

  it('counts by tier, zero-filling missing tiers; empty list short-circuits', async () => {
    expect(await repo.countByTier([])).toEqual({ REGULAR: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 });
    expect(loyaltyAccount.groupBy).not.toHaveBeenCalled();

    loyaltyAccount.groupBy.mockResolvedValue([
      { tier: 'GOLD', _count: { _all: 2 } },
      { tier: 'SILVER', _count: { _all: 3 } },
    ]);
    const out = await repo.countByTier(['cust-1', 'cust-2']);
    expect(out).toEqual({ REGULAR: 0, SILVER: 3, GOLD: 2, PLATINUM: 0 });
    expect(loyaltyAccount.groupBy).toHaveBeenCalledWith({
      by: ['tier'],
      where: { customerId: { in: ['cust-1', 'cust-2'] } },
      _count: { _all: true },
    });
  });

  it('sums points balance; empty list short-circuits and null sum -> 0', async () => {
    expect(await repo.sumPointsBalance([])).toBe(0);
    expect(loyaltyAccount.aggregate).not.toHaveBeenCalled();

    loyaltyAccount.aggregate.mockResolvedValue({ _sum: { pointsBalance: 4200 } });
    expect(await repo.sumPointsBalance(['cust-1'])).toBe(4200);

    loyaltyAccount.aggregate.mockResolvedValue({ _sum: { pointsBalance: null } });
    expect(await repo.sumPointsBalance(['cust-1'])).toBe(0);
  });

  it('sums redeemed points since a date; empty list short-circuits', async () => {
    expect(await repo.sumRedeemedSince([], new Date())).toBe(0);
    expect(rewardRedemption.aggregate).not.toHaveBeenCalled();

    const since = new Date('2026-01-01');
    rewardRedemption.aggregate.mockResolvedValue({ _sum: { pointsSpent: 800 } });
    expect(await repo.sumRedeemedSince(['cust-1'], since)).toBe(800);
    expect(rewardRedemption.aggregate).toHaveBeenCalledWith({
      where: { customerId: { in: ['cust-1'] }, createdAt: { gte: since } },
      _sum: { pointsSpent: true },
    });
  });

  it('finds an existing EARN entry by order (idempotency), null on miss', async () => {
    pointsTransaction.findUnique.mockResolvedValue(txnRow());
    const out = await repo.findEarnByOrder('ord-1');
    expect(out?.type).toBe(PointsTxnType.EARN);
    expect(pointsTransaction.findUnique).toHaveBeenCalledWith({
      where: { orderId_type: { orderId: 'ord-1', type: PointsTxnType.EARN } },
    });

    pointsTransaction.findUnique.mockResolvedValue(null);
    expect(await repo.findEarnByOrder('ord-2')).toBeNull();
  });

  it('records an earn atomically: ledger insert + account totals in one transaction', async () => {
    pointsTransaction.create.mockReturnValue('ledger-op' as never);
    loyaltyAccount.update.mockReturnValue(accountRow() as never);
    const out = await repo.recordEarn({
      accountId: 'acc-1',
      customerId: 'cust-1',
      points: 100,
      reason: null,
      newBalance: 1300,
      newLifetime: 6100,
      newTier: MembershipTier.GOLD,
      orderId: 'ord-1',
      expiresAt: new Date('2026-07-01'),
    });
    expect(out.tier).toBe(MembershipTier.GOLD);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(pointsTransaction.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc-1',
        customerId: 'cust-1',
        type: PointsTxnType.EARN,
        points: 100,
        orderId: 'ord-1',
        reason: null,
        expiresAt: new Date('2026-07-01'),
      },
    });
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { pointsBalance: 1300, lifetimePoints: 6100, tier: 'GOLD' },
    });
  });

  it('records an adjustment atomically with the given txn type', async () => {
    pointsTransaction.create.mockReturnValue('ledger-op' as never);
    loyaltyAccount.update.mockReturnValue(accountRow() as never);
    await repo.recordAdjustment({
      accountId: 'acc-1',
      customerId: 'cust-1',
      points: -50,
      reason: 'manual correction',
      newBalance: 1150,
      newLifetime: 6000,
      newTier: MembershipTier.GOLD,
      type: PointsTxnType.ADJUST,
    });
    expect(pointsTransaction.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc-1',
        customerId: 'cust-1',
        type: PointsTxnType.ADJUST,
        points: -50,
        reason: 'manual correction',
      },
    });
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { pointsBalance: 1150, lifetimePoints: 6000, tier: 'GOLD' },
    });
  });

  it('lists transactions with pagination and maps the txn type', async () => {
    pointsTransaction.findMany.mockReturnValue([txnRow()] as never);
    pointsTransaction.count.mockReturnValue(1 as never);
    const out = await repo.listTransactions('cust-1', 2, 10);
    expect(out.total).toBe(1);
    expect(out.items[0].type).toBe(PointsTxnType.EARN);
    expect(pointsTransaction.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(pointsTransaction.count).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
  });

  it('finds expirable EARN lots past their expiry', async () => {
    pointsTransaction.findMany.mockResolvedValue([txnRow()]);
    const now = new Date('2026-08-01');
    const out = await repo.findExpirableLots(now, 100);
    expect(out).toHaveLength(1);
    expect(pointsTransaction.findMany).toHaveBeenCalledWith({
      where: { type: PointsTxnType.EARN, expired: false, expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
  });

  it('records expiry: mark lot expired + negative EXPIRE entry + balance debit', async () => {
    pointsTransaction.update.mockReturnValue('mark' as never);
    pointsTransaction.create.mockReturnValue('expire-entry' as never);
    loyaltyAccount.update.mockReturnValue('debit' as never);
    await repo.recordExpiry({
      lotId: 'txn-1',
      accountId: 'acc-1',
      customerId: 'cust-1',
      points: 100,
      newBalance: 1100,
    });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(pointsTransaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { expired: true },
    });
    expect(pointsTransaction.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc-1',
        customerId: 'cust-1',
        type: PointsTxnType.EXPIRE,
        points: -100,
        reason: 'Points expired',
      },
    });
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { pointsBalance: 1100 },
    });
  });
});

describe('RewardPrismaRepository', () => {
  const rewardItem = { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const rewardRedemption = { create: jest.fn(), findUnique: jest.fn() };
  const pointsTransaction = { create: jest.fn() };
  const loyaltyAccount = { update: jest.fn() };
  const $transaction = jest.fn((ops: unknown) => Promise.resolve(ops));
  const prisma = {
    rewardItem,
    rewardRedemption,
    pointsTransaction,
    loyaltyAccount,
    $transaction,
  } as unknown as PrismaService;
  const repo = new RewardPrismaRepository(prisma);

  const itemRow = {
    id: 'ri-1',
    name: 'Free Galon',
    unit: 'galon',
    pointsCost: 500,
    imageUrl: null,
    active: true,
    stock: 10,
  };
  const redemptionRow = {
    id: 'rd-1',
    rewardItemId: 'ri-1',
    customerId: 'cust-1',
    pointsSpent: 500,
    createdAt: new Date('2026-01-02'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists active items cheapest-first', async () => {
    rewardItem.findMany.mockResolvedValue([itemRow]);
    expect(await repo.listActiveItems()).toEqual([itemRow]);
    expect(rewardItem.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { pointsCost: 'asc' },
    });
  });

  it('finds an item by id, null on miss', async () => {
    rewardItem.findUnique.mockResolvedValue(null);
    expect(await repo.findItem('nope')).toBeNull();
    expect(rewardItem.findUnique).toHaveBeenCalledWith({ where: { id: 'nope' } });
  });

  it('finds a prior redemption by idempotency key', async () => {
    rewardRedemption.findUnique.mockResolvedValue(redemptionRow);
    const out = await repo.findRedemptionByKey('cust-1', 'idem-1');
    expect(out).toEqual(redemptionRow);
    expect(rewardRedemption.findUnique).toHaveBeenCalledWith({
      where: { customerId_idempotencyKey: { customerId: 'cust-1', idempotencyKey: 'idem-1' } },
    });
  });

  it('redeems atomically with a stock decrement when the item is finite', async () => {
    rewardRedemption.create.mockReturnValue(redemptionRow as never);
    pointsTransaction.create.mockReturnValue('ledger' as never);
    loyaltyAccount.update.mockReturnValue('debit' as never);
    rewardItem.update.mockReturnValue('stock' as never);
    const out = await repo.redeem({
      accountId: 'acc-1',
      customerId: 'cust-1',
      rewardItemId: 'ri-1',
      idempotencyKey: 'idem-1',
      pointsSpent: 500,
      newBalance: 700,
      reason: 'Redeemed Free Galon',
      decrementStock: true,
    });
    expect(out).toEqual(redemptionRow);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(rewardRedemption.create).toHaveBeenCalledWith({
      data: {
        rewardItemId: 'ri-1',
        customerId: 'cust-1',
        pointsSpent: 500,
        idempotencyKey: 'idem-1',
      },
    });
    // Negative ledger entry, lifetime/tier untouched (spend never promotes).
    expect(pointsTransaction.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc-1',
        customerId: 'cust-1',
        type: PointsTxnType.REDEEM,
        points: -500,
        reason: 'Redeemed Free Galon',
      },
    });
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { pointsBalance: 700 },
    });
    expect(rewardItem.update).toHaveBeenCalledWith({
      where: { id: 'ri-1' },
      data: { stock: { decrement: 1 } },
    });
  });

  it('skips the stock decrement for unlimited items', async () => {
    rewardRedemption.create.mockReturnValue(redemptionRow as never);
    pointsTransaction.create.mockReturnValue('ledger' as never);
    loyaltyAccount.update.mockReturnValue('debit' as never);
    await repo.redeem({
      accountId: 'acc-1',
      customerId: 'cust-1',
      rewardItemId: 'ri-1',
      idempotencyKey: 'idem-2',
      pointsSpent: 500,
      newBalance: 700,
      reason: 'Redeemed Free Galon',
      decrementStock: false,
    });
    expect(rewardItem.update).not.toHaveBeenCalled();
  });
});
