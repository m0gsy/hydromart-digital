import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { LoyaltyPrismaRepository } from '../../src/infrastructure/prisma/loyalty.prisma.repository';
import { RewardPrismaRepository } from '../../src/infrastructure/prisma/reward.prisma.repository';
import { InsufficientPointsError, InvalidAdjustmentError } from '../../src/domain/errors';
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
    findUniqueOrThrow: jest.fn(),
    upsert: jest.fn(),
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
  // The expiry debit is raw SQL (GREATEST clamps it at zero); the tag returns a build-time
  // op like every other, so the transaction still sees an array of three.
  const $executeRaw = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join('?'),
    values,
  }));
  const prisma = {
    loyaltyAccount,
    pointsTransaction,
    rewardRedemption,
    $transaction,
    $executeRaw,
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
    loyaltyAccount.upsert.mockResolvedValue(accountRow());
    const out = await repo.createAccount('cust-1');
    expect(out.tier).toBe(MembershipTier.GOLD);
    expect(loyaltyAccount.upsert).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      create: { customerId: 'cust-1' },
      update: {},
    });
  });

  // Two first-ever movements for one customer land together; an account is a container,
  // not something the caller can conflict over, so the loser reads the winner's back.
  it('reads back the existing account when the create loses the race', async () => {
    loyaltyAccount.upsert.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    loyaltyAccount.findUniqueOrThrow.mockResolvedValue(accountRow());
    await expect(repo.createAccount('cust-1')).resolves.toMatchObject({ id: 'acc-1' });
  });

  it('rethrows any other failure from the account create', async () => {
    const boom = Object.assign(new Error('down'), { code: 'P1001' });
    loyaltyAccount.upsert.mockRejectedValue(boom);
    await expect(repo.createAccount('cust-1')).rejects.toBe(boom);
  });

  it('writes the tier the authoritative lifetime earns', async () => {
    loyaltyAccount.update.mockResolvedValue(accountRow());
    await repo.setTier('acc-1', MembershipTier.PLATINUM);
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { tier: 'PLATINUM' },
    });
  });

  // The balance floor rejecting a debit is the caller's answer, not a server fault.
  it('reports a rejected balance floor as an invalid adjustment, not a 500', async () => {
    $transaction.mockRejectedValueOnce(Object.assign(new Error('no row'), { code: 'P2025' }));
    await expect(
      repo.recordAdjustment({
        accountId: 'acc-1',
        customerId: 'cust-1',
        points: -50,
        reason: null,
        lifetimeDelta: 0,
        type: PointsTxnType.ADJUST,
      }),
    ).rejects.toBeInstanceOf(InvalidAdjustmentError);
  });

  it('rethrows any other adjustment failure', async () => {
    const boom = Object.assign(new Error('down'), { code: 'P1001' });
    $transaction.mockRejectedValueOnce(boom);
    await expect(
      repo.recordAdjustment({
        accountId: 'acc-1',
        customerId: 'cust-1',
        points: 50,
        reason: null,
        lifetimeDelta: 50,
        type: PointsTxnType.ADJUST,
      }),
    ).rejects.toBe(boom);
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
      lifetimeDelta: 100,
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
    // H-2: deltas the database applies, not absolutes computed from a stale read.
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { pointsBalance: { increment: 100 }, lifetimePoints: { increment: 100 } },
    });
  });

  /*
   * The second push of the same completed order.
   *
   * The service's `findEarnByOrder` check is not the guard — two pushes both read "not
   * earned" and both insert. `@@unique([orderId, type])` is. payout-service wrote the rest
   * of this down already: without a catch the index stops the double credit "by throwing a
   * 500 at whoever lost, which reads as a broken payout rather than a duplicate that was
   * correctly refused". Order completion is pushed at-least-once, so the loser is the
   * retry doing its job, not an edge case.
   */
  it('reports the account the winner credited when a second earn loses the unique index', async () => {
    $transaction.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    loyaltyAccount.findUniqueOrThrow.mockResolvedValue(accountRow() as never);

    const out = await repo.recordEarn({
      accountId: 'acc-1',
      customerId: 'cust-1',
      points: 100,
      reason: null,
      lifetimeDelta: 100,
      orderId: 'ord-1',
      expiresAt: new Date('2026-07-01'),
    });

    expect(out.tier).toBe(MembershipTier.GOLD);
    expect(loyaltyAccount.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'acc-1' } });
  });

  it('rethrows any other earn failure', async () => {
    const boom = Object.assign(new Error('down'), { code: 'P1001' });
    $transaction.mockRejectedValueOnce(boom);
    await expect(
      repo.recordEarn({
        accountId: 'acc-1',
        customerId: 'cust-1',
        points: 100,
        reason: null,
        lifetimeDelta: 100,
        orderId: 'ord-1',
        expiresAt: new Date('2026-07-01'),
      }),
    ).rejects.toBe(boom);
  });

  it('records an adjustment atomically with the given txn type', async () => {
    pointsTransaction.create.mockReturnValue('ledger-op' as never);
    loyaltyAccount.update.mockReturnValue(accountRow() as never);
    await repo.recordAdjustment({
      accountId: 'acc-1',
      customerId: 'cust-1',
      points: -50,
      reason: 'manual correction',
      lifetimeDelta: 0,
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
    // A debit carries the balance floor in its WHERE; two of them cannot both pass.
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1', pointsBalance: { gte: 50 } },
      data: { pointsBalance: { increment: -50 }, lifetimePoints: { increment: 0 } },
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
    // GREATEST clamps at zero in the database, so an over-large lot empties the account
    // instead of driving it negative — and it reads the balance at write time, not before.
    expect($executeRaw.mock.calls[0][0].join('')).toContain('GREATEST(0, "pointsBalance" -');
    expect($executeRaw.mock.calls[0].slice(1)).toEqual([100, 'acc-1']);
  });
});

describe('RewardPrismaRepository', () => {
  const rewardItem = { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const rewardRedemption = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
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
    status: 'ACTIVE',
    depotId: 'depot-1',
    usedAt: null,
    cancelledAt: null,
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

  it("lists a customer's redemptions newest-first with the reward label joined", async () => {
    rewardRedemption.findMany.mockResolvedValue([
      { ...redemptionRow, reward: { name: 'Free Galon' } },
    ]);
    const out = await repo.listRedemptionsByCustomer('cust-1');
    expect(out).toEqual([{ ...redemptionRow, rewardName: 'Free Galon' }]);
    expect(rewardRedemption.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
      include: { reward: { select: { name: true } } },
    });
  });

  it('lists the hand-over queue oldest-first so the longest wait is served first', async () => {
    rewardRedemption.findMany.mockResolvedValue([
      { ...redemptionRow, reward: { name: 'Free Galon' } },
    ]);
    const out = await repo.listRedemptionsByStatus('ACTIVE');
    expect(out[0]).toMatchObject({ id: 'rd-1', rewardName: 'Free Galon' });
    expect(rewardRedemption.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      include: { reward: { select: { name: true } } },
    });
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
      depotId: 'depot-1',
      pointsSpent: 500,
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
        depotId: 'depot-1',
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
    // H-2: a relative debit under a balance floor. Two concurrent redemptions can both
    // pass the service's read; only one can match this WHERE.
    expect(loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1', pointsBalance: { gte: 500 } },
      data: { pointsBalance: { decrement: 500 } },
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
      depotId: 'depot-1',
      pointsSpent: 500,
      reason: 'Redeemed Free Galon',
      decrementStock: false,
    });
    expect(rewardItem.update).not.toHaveBeenCalled();
  });

  it('finds one redemption by id, mapping the status text (M14-03)', async () => {
    rewardRedemption.findUnique.mockResolvedValue(redemptionRow);
    expect(await repo.findRedemption('rd-1')).toMatchObject({ id: 'rd-1', status: 'ACTIVE' });
    expect(rewardRedemption.findUnique).toHaveBeenCalledWith({ where: { id: 'rd-1' } });
  });

  it('returns null for an unknown redemption (M14-03)', async () => {
    rewardRedemption.findUnique.mockResolvedValue(null);
    expect(await repo.findRedemption('nope')).toBeNull();
  });

  it('finds a prior redemption by idempotency key', async () => {
    rewardRedemption.findUnique.mockResolvedValue(redemptionRow);
    expect(await repo.findRedemptionByKey('cust-1', 'idem-1')).toMatchObject({ id: 'rd-1' });
    rewardRedemption.findUnique.mockResolvedValue(null);
    expect(await repo.findRedemptionByKey('cust-1', 'missing')).toBeNull();
  });

  it('stamps a redemption as used (M14-03)', async () => {
    rewardRedemption.update.mockResolvedValue({
      ...redemptionRow,
      status: 'USED',
      usedAt: new Date('2026-01-03'),
    });
    const out = await repo.markUsed('rd-1');
    expect(out.status).toBe('USED');
    const [[args]] = rewardRedemption.update.mock.calls;
    expect(args.where).toEqual({ id: 'rd-1' });
    expect(args.data.status).toBe('USED');
  });

  it('cancels atomically: status guard, credit entry, balance, stock restore (M14-03)', async () => {
    rewardRedemption.update.mockReturnValue({
      ...redemptionRow,
      status: 'CANCELLED',
      cancelledAt: new Date('2026-01-04'),
    } as never);
    pointsTransaction.create.mockReturnValue('credit' as never);
    loyaltyAccount.update.mockReturnValue('rebate' as never);
    rewardItem.update.mockReturnValue('stock' as never);

    const out = await repo.cancel({
      redemptionId: 'rd-1',
      accountId: 'acc-1',
      customerId: 'cust-1',
      rewardItemId: 'ri-1',
      pointsRefunded: 500,
      reason: 'Cancelled Free Galon',
      restoreStock: true,
    });

    expect(out.status).toBe('CANCELLED');
    // The WHERE guard is what stops two concurrent cancels from refunding twice.
    const [[args]] = rewardRedemption.update.mock.calls;
    expect(args.where).toEqual({ id: 'rd-1', status: 'ACTIVE' });
    expect(pointsTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ points: 500 }) }),
    );
    expect(rewardItem.update).toHaveBeenCalledWith({
      where: { id: 'ri-1' },
      data: { stock: { increment: 1 } },
    });
  });

  it('skips the stock restore for unlimited items (M14-03)', async () => {
    rewardRedemption.update.mockReturnValue({ ...redemptionRow, status: 'CANCELLED' } as never);
    pointsTransaction.create.mockReturnValue('credit' as never);
    loyaltyAccount.update.mockReturnValue('rebate' as never);
    await repo.cancel({
      redemptionId: 'rd-1',
      accountId: 'acc-1',
      customerId: 'cust-1',
      rewardItemId: 'ri-1',
      pointsRefunded: 500,
      reason: 'Cancelled Free Galon',
      restoreStock: false,
    });
    expect(rewardItem.update).not.toHaveBeenCalled();
  });

  // Losing the balance floor means somebody else spent the points first. That is the
  // customer's answer, and it must not read as a server fault.
  it('reports a lost balance floor as insufficient points, not a 500', async () => {
    $transaction.mockRejectedValueOnce(Object.assign(new Error('no row'), { code: 'P2025' }));
    await expect(
      repo.redeem({
        accountId: 'acc-1',
        customerId: 'cust-1',
        rewardItemId: 'ri-1',
        idempotencyKey: 'key-1',
        depotId: 'depot-1',
        pointsSpent: 500,
        reason: 'Redeemed Free Galon',
        decrementStock: false,
      }),
    ).rejects.toBeInstanceOf(InsufficientPointsError);
  });

  /*
   * The idempotency key doing what an idempotency key is for.
   *
   * A client retries — which is the entire reason it sends a key — and both attempts read
   * "not redeemed" and both insert. `@@unique([customerId, idempotencyKey])` stops the
   * second. Left raw, the loser's P2002 is a 500: the customer is told the redemption
   * failed while their points are gone and a voucher is waiting for them.
   */
  it('returns the redemption the winner wrote when a retry loses the idempotency key', async () => {
    $transaction.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    rewardRedemption.findUnique.mockResolvedValue(redemptionRow as never);

    const out = await repo.redeem({
      accountId: 'acc-1',
      customerId: 'cust-1',
      rewardItemId: 'ri-1',
      idempotencyKey: 'key-1',
      depotId: 'depot-1',
      pointsSpent: 500,
      reason: 'Redeemed Free Galon',
      decrementStock: false,
    });

    expect(out.id).toBe(redemptionRow.id);
    expect(rewardRedemption.findUnique).toHaveBeenCalledWith({
      where: { customerId_idempotencyKey: { customerId: 'cust-1', idempotencyKey: 'key-1' } },
    });
  });

  // A P2002 with nothing to read back is a DIFFERENT unique index, and treating it as this
  // race would report a redemption that never happened.
  it('rethrows a P2002 that is not the idempotency key', async () => {
    const dup = Object.assign(new Error('dup'), { code: 'P2002' });
    $transaction.mockRejectedValueOnce(dup);
    rewardRedemption.findUnique.mockResolvedValue(null as never);
    await expect(
      repo.redeem({
        accountId: 'acc-1',
        customerId: 'cust-1',
        rewardItemId: 'ri-1',
        idempotencyKey: 'key-1',
        depotId: 'depot-1',
        pointsSpent: 500,
        reason: 'Redeemed Free Galon',
        decrementStock: false,
      }),
    ).rejects.toBe(dup);
  });

  it('rethrows any other redemption failure', async () => {
    const boom = Object.assign(new Error('down'), { code: 'P1001' });
    $transaction.mockRejectedValueOnce(boom);
    await expect(
      repo.redeem({
        accountId: 'acc-1',
        customerId: 'cust-1',
        rewardItemId: 'ri-1',
        idempotencyKey: 'key-1',
        depotId: 'depot-1',
        pointsSpent: 500,
        reason: 'Redeemed Free Galon',
        decrementStock: false,
      }),
    ).rejects.toBe(boom);
  });
});
