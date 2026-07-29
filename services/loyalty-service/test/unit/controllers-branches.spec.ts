import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { MembershipTier } from '../../src/domain/membership';
import { PointsTxnType } from '../../src/domain/points';
import {
  LoyaltyAccountRecord,
  PointsTransactionRecord,
} from '../../src/application/ports/loyalty.repository';
import { RewardItemRecord } from '../../src/application/ports/reward.repository';
import { LoyaltyController } from '../../src/modules/loyalty.controller';
import { RewardController } from '../../src/modules/reward.controller';
import { HealthController } from '../../src/modules/health.controller';
import { SettingsController } from '../../src/modules/settings.controller';
import { LoyaltyAccountDto, PointsTransactionDto } from '../../src/modules/dto/loyalty.dto';
import { RewardItemDto, RedeemResultDto } from '../../src/modules/dto/reward.dto';

// Thin delegate-assert controller tests: each handler forwards to its service and maps
// the record through the response DTO. Importing the controllers also loads their DTO
// files; the `.from` mappers are asserted directly below. No Nest DI container, no HTTP.

const account = (over: Partial<LoyaltyAccountRecord> = {}): LoyaltyAccountRecord => ({
  id: 'acc-1',
  customerId: 'cust-1',
  tier: MembershipTier.GOLD,
  pointsBalance: 1200,
  lifetimePoints: 6000,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
});

const txn: PointsTransactionRecord = {
  id: 'txn-1',
  customerId: 'cust-1',
  type: PointsTxnType.EARN,
  points: 60,
  orderId: 'ord-1',
  reason: 'Order completed',
  expiresAt: new Date('2027-01-01'),
  expired: false,
  createdAt: new Date('2026-01-01'),
};

const user = (over: Record<string, unknown> = {}): AuthenticatedUser =>
  ({ sub: 'cust-1', role: 'CUSTOMER', ...over }) as unknown as AuthenticatedUser;

describe('LoyaltyController (delegation)', () => {
  const loyalty = {
    getTiers: jest.fn(() => ['tier']),
    getAccount: jest.fn(async () => account()),
    listTransactions: jest.fn(async () => ({
      items: [txn],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    })),
    earnForOrder: jest.fn(async () => ({
      account: account(),
      pointsEarned: 60,
      alreadyEarned: false,
    })),
    adjust: jest.fn(async () => account()),
    reward: jest.fn(async () => account()),
    runExpiry: jest.fn(async () => ({ lotsExpired: 0, pointsExpired: 0 })),
    countMembers: jest.fn(async () => 42),
    depotSummary: jest.fn(async () => ({ depotId: 'd1' })),
  };
  const ctrl = new LoyaltyController(loyalty as never);
  beforeEach(() => jest.clearAllMocks());

  it('tiers() returns the tier table', () => {
    expect(ctrl.tiers()).toEqual(['tier']);
  });

  it('me() maps the current account', async () => {
    const out = await ctrl.me(user());
    expect(out).toBeInstanceOf(Object);
    expect(out.tier).toBe(MembershipTier.GOLD);
    expect(loyalty.getAccount).toHaveBeenCalledWith('cust-1');
  });

  it('myTransactions() maps the ledger page', async () => {
    const out = await ctrl.myTransactions(user(), { page: 1, limit: 20 });
    expect(out.items[0]).toMatchObject({ id: 'txn-1', type: PointsTxnType.EARN });
    expect(loyalty.listTransactions).toHaveBeenCalledWith('cust-1', 1, 20);
  });

  it('earn() forwards depotId when present', async () => {
    await ctrl.earn({ customerId: 'c', orderId: 'o', subtotal: 60000, depotId: 'd1' } as never);
    expect(loyalty.earnForOrder).toHaveBeenCalledWith('c', 'o', 60000, 'd1');
  });

  it('earn() defaults depotId to null when omitted', async () => {
    await ctrl.earn({ customerId: 'c', orderId: 'o', subtotal: 60000 } as never);
    expect(loyalty.earnForOrder).toHaveBeenCalledWith('c', 'o', 60000, null);
  });

  it('adjust() forwards the signed delta', async () => {
    await ctrl.adjust({ customerId: 'c', points: -50, reason: 'fix' } as never);
    expect(loyalty.adjust).toHaveBeenCalledWith('c', -50, 'fix');
  });

  it('reward() forwards the grant', async () => {
    await ctrl.reward({ customerId: 'c', points: 500, reason: 'referral' } as never);
    expect(loyalty.reward).toHaveBeenCalledWith('c', 500, 'referral');
  });

  it('expire() sweeps lots', () => {
    ctrl.expire();
    expect(loyalty.runExpiry).toHaveBeenCalled();
  });

  it('memberCount() wraps the count', async () => {
    expect(await ctrl.memberCount()).toEqual({ count: 42 });
  });

  it('depotSummary() forwards the depotId', () => {
    ctrl.depotSummary({ depotId: 'd1' } as never);
    expect(loyalty.depotSummary).toHaveBeenCalledWith('d1');
  });

  it('byCustomer() reads a staff-scoped account', async () => {
    const out = await ctrl.byCustomer('cust-9');
    expect(out.customerId).toBe('cust-1');
    expect(loyalty.getAccount).toHaveBeenCalledWith('cust-9');
  });
});

describe('RewardController (delegation)', () => {
  const item: RewardItemRecord = {
    id: 'ri-1',
    name: 'Galon',
    unit: 'galon',
    pointsCost: 800,
    imageUrl: null,
    active: true,
    stock: 5,
  };
  const rewards = {
    listCatalog: jest.fn(async () => [item]),
    listAll: jest.fn(async () => [item, { ...item, id: 'ri-2', active: false }]),
    createItem: jest.fn(async () => item),
    updateItem: jest.fn(async () => ({ ...item, active: false })),
    redeem: jest.fn(async () => ({
      redemption: { id: 'rd-1', rewardItemId: 'ri-1', pointsSpent: 800, status: 'ACTIVE' },
      pointsBalance: 400,
    })),
    cancel: jest.fn(async () => ({
      redemption: { id: 'rd-1', rewardItemId: 'ri-1', pointsSpent: 800, status: 'CANCELLED' },
      pointsBalance: 1200,
    })),
    markUsed: jest.fn(async () => ({
      id: 'rd-1',
      rewardItemId: 'ri-1',
      pointsSpent: 800,
      status: 'USED',
      usedAt: new Date('2026-01-03T00:00:00.000Z'),
      cancelledAt: null,
    })),
    listMine: jest.fn(async () => [
      {
        id: 'rd-1',
        rewardItemId: 'ri-1',
        customerId: 'cust-1',
        depotId: 'depot-1',
        rewardName: 'Galon',
        pointsSpent: 800,
        status: 'ACTIVE',
        usedAt: null,
        cancelledAt: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]),
    listAwaitingHandover: jest.fn(async () => [
      {
        id: 'rd-2',
        rewardItemId: 'ri-1',
        customerId: 'cust-9',
        depotId: 'depot-1',
        rewardName: 'Galon',
        pointsSpent: 800,
        status: 'ACTIVE',
        usedAt: null,
        cancelledAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]),
  };
  const ctrl = new RewardController(rewards as never);
  beforeEach(() => jest.clearAllMocks());

  it('catalog() maps active items', async () => {
    const out = await ctrl.catalog();
    expect(out).toEqual([
      {
        id: 'ri-1',
        name: 'Galon',
        unit: 'galon',
        pointsCost: 800,
        imageUrl: null,
        stock: 5,
        active: true,
      },
    ]);
  });

  it('items() lists retired entries too', async () => {
    const out = await ctrl.items();
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 'ri-2', active: false });
  });

  it('createItem() defaults optional fields instead of passing undefined through', async () => {
    await ctrl.createItem({ name: 'Galon', unit: 'galon', pointsCost: 800 } as never);
    expect(rewards.createItem).toHaveBeenCalledWith({
      name: 'Galon',
      unit: 'galon',
      pointsCost: 800,
      imageUrl: null,
      stock: null,
      active: true,
    });
  });

  it('createItem() keeps an explicit finite stock and inactive flag', async () => {
    await ctrl.createItem({
      name: 'Galon',
      unit: 'galon',
      pointsCost: 800,
      stock: 0,
      active: false,
      imageUrl: 'u',
    } as never);
    expect(rewards.createItem).toHaveBeenCalledWith({
      name: 'Galon',
      unit: 'galon',
      pointsCost: 800,
      imageUrl: 'u',
      stock: 0,
      active: false,
    });
  });

  it('updateItem() forwards the patch and maps the result', async () => {
    const out = await ctrl.updateItem('ri-1', { active: false } as never);
    expect(rewards.updateItem).toHaveBeenCalledWith('ri-1', { active: false });
    expect(out).toMatchObject({ id: 'ri-1', active: false });
  });

  it('redeem() maps the redeem result', async () => {
    const out = await ctrl.redeem(user(), {
      rewardItemId: 'ri-1',
      idempotencyKey: 'k1',
      depotId: 'depot-1',
    } as never);
    expect(out).toEqual({
      redemptionId: 'rd-1',
      rewardItemId: 'ri-1',
      pointsSpent: 800,
      pointsBalance: 400,
      status: 'ACTIVE',
    });
    expect(rewards.redeem).toHaveBeenCalledWith('cust-1', 'ri-1', 'k1', 'depot-1');
  });

  it('cancelRedemption() scopes the cancel to the caller (M14-03)', async () => {
    const out = await ctrl.cancelRedemption(user(), 'rd-1');
    expect(rewards.cancel).toHaveBeenCalledWith('cust-1', 'rd-1');
    expect(out).toMatchObject({ status: 'CANCELLED', pointsBalance: 1200 });
  });

  it('myRedemptions() scopes the list to the caller and joins the reward label', async () => {
    const out = await ctrl.myRedemptions(user());
    expect(rewards.listMine).toHaveBeenCalledWith('cust-1');
    expect(out).toEqual([
      {
        id: 'rd-1',
        rewardItemId: 'ri-1',
        customerId: 'cust-1',
        depotId: 'depot-1',
        rewardName: 'Galon',
        pointsSpent: 800,
        status: 'ACTIVE',
        usedAt: null,
        cancelledAt: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('activeRedemptions() scopes to a depot when given, and network-wide when not', async () => {
    await ctrl.activeRedemptions('depot-1');
    expect(rewards.listAwaitingHandover).toHaveBeenCalledWith('depot-1');
    // An empty query string must mean "no filter", not "a depot named empty string".
    await ctrl.activeRedemptions('');
    expect(rewards.listAwaitingHandover).toHaveBeenLastCalledWith(undefined);
    const out = await ctrl.activeRedemptions();
    expect(rewards.listAwaitingHandover).toHaveBeenLastCalledWith(undefined);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'rd-2', customerId: 'cust-9', status: 'ACTIVE' });
  });

  it('markRedemptionUsed() maps the hand-over stamp (M14-03)', async () => {
    const out = await ctrl.markRedemptionUsed('rd-1');
    expect(rewards.markUsed).toHaveBeenCalledWith('rd-1');
    expect(out).toEqual({
      id: 'rd-1',
      rewardItemId: 'ri-1',
      pointsSpent: 800,
      status: 'USED',
      usedAt: '2026-01-03T00:00:00.000Z',
      cancelledAt: null,
    });
  });
});

describe('HealthController', () => {
  it('reports ok when the DB probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const out = await new HealthController(prisma as never).check();
    expect(out).toMatchObject({
      status: 'ok',
      service: 'loyalty-service',
      checks: { database: 'up' },
    });
  });

  it('throws ServiceUnavailable when the DB probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(new HealthController(prisma as never).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('SettingsController (guards + delegation)', () => {
  const settings = {
    schema: jest.fn(async () => ({})),
    put: jest.fn(async () => undefined),
    reset: jest.fn(async () => undefined),
  };
  const ctrl = new SettingsController(settings as never);
  beforeEach(() => jest.clearAllMocks());

  it('schema() defaults an absent depotId to null', () => {
    ctrl.schema();
    expect(settings.schema).toHaveBeenCalledWith(null);
    ctrl.schema('d1');
    expect(settings.schema).toHaveBeenCalledWith('d1');
  });

  it('put() rejects a GLOBAL change from a non-super-admin', async () => {
    await expect(
      ctrl.put(
        { scope: 'GLOBAL', key: 'earnRateRupiah', value: '1' } as never,
        user({ role: 'DEPOT_MANAGER' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settings.put).not.toHaveBeenCalled();
  });

  it('put() lets SUPER_ADMIN set a GLOBAL override', async () => {
    await ctrl.put(
      { scope: 'GLOBAL', key: 'earnRateRupiah', value: '1' } as never,
      user({ sub: 'u1', role: 'SUPER_ADMIN' }),
    );
    expect(settings.put).toHaveBeenCalledWith({
      scope: 'GLOBAL',
      depotId: null,
      key: 'earnRateRupiah',
      value: '1',
      updatedBy: 'u1',
    });
  });

  it('put() lets a depot admin set a DEPOT override (depotId forwarded)', async () => {
    await ctrl.put(
      { scope: 'DEPOT', depotId: 'd1', key: 'earnRateRupiah', value: '1' } as never,
      user({ sub: 'u2', role: 'DEPOT_MANAGER' }),
    );
    expect(settings.put).toHaveBeenCalledWith({
      scope: 'DEPOT',
      depotId: 'd1',
      key: 'earnRateRupiah',
      value: '1',
      updatedBy: 'u2',
    });
  });

  it('reset() rejects a GLOBAL reset from a non-super-admin', async () => {
    await expect(
      ctrl.reset(
        { scope: 'GLOBAL', key: 'earnRateRupiah' } as never,
        user({ role: 'DEPOT_MANAGER' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reset() removes a DEPOT override', async () => {
    await ctrl.reset(
      { scope: 'DEPOT', depotId: 'd1', key: 'earnRateRupiah' } as never,
      user({ role: 'DEPOT_MANAGER' }),
    );
    expect(settings.reset).toHaveBeenCalledWith('DEPOT', 'd1', 'earnRateRupiah');
  });
});

describe('response DTO mappers', () => {
  it('LoyaltyAccountDto.from includes the tier discount rate', () => {
    expect(LoyaltyAccountDto.from(account())).toEqual({
      customerId: 'cust-1',
      tier: MembershipTier.GOLD,
      pointsBalance: 1200,
      lifetimePoints: 6000,
      discountRate: 0.05,
    });
  });

  it('PointsTransactionDto.from projects ledger fields', () => {
    expect(PointsTransactionDto.from(txn)).toEqual({
      id: 'txn-1',
      type: PointsTxnType.EARN,
      points: 60,
      orderId: 'ord-1',
      reason: 'Order completed',
      expiresAt: txn.expiresAt,
      createdAt: txn.createdAt,
    });
  });

  it('RewardItemDto.from projects catalog fields', () => {
    const item: RewardItemRecord = {
      id: 'ri-1',
      name: 'Galon',
      unit: 'galon',
      pointsCost: 800,
      imageUrl: 'x',
      active: true,
      stock: null,
    };
    expect(RewardItemDto.from(item)).toEqual({
      id: 'ri-1',
      name: 'Galon',
      unit: 'galon',
      pointsCost: 800,
      imageUrl: 'x',
      stock: null,
      active: true,
    });
  });

  it('RedeemResultDto.from projects the redemption + balance', () => {
    const out = RedeemResultDto.from({
      redemption: {
        id: 'rd-1',
        rewardItemId: 'ri-1',
        customerId: 'c',
        depotId: 'depot-1',
        pointsSpent: 800,
        status: 'ACTIVE',
        usedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
      },
      pointsBalance: 400,
    });
    expect(out).toEqual({
      redemptionId: 'rd-1',
      rewardItemId: 'ri-1',
      pointsSpent: 800,
      pointsBalance: 400,
      status: 'ACTIVE',
    });
  });
});
