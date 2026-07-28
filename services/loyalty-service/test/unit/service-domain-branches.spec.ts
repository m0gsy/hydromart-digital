import { PointsTxnType } from '../../src/domain/points';
import { MembershipTier, TIER_BENEFITS, benefitFor } from '../../src/domain/membership';
import { buildPage } from '../../src/application/pagination';
import {
  InsufficientPointsError,
  InvalidAdjustmentError,
  LoyaltyAccountNotFoundError,
  RewardItemNotFoundError,
  RewardOutOfStockError,
} from '../../src/domain/errors';
import { LoyaltyService } from '../../src/application/services/loyalty.service';
import {
  InMemoryCustomerDirectory,
  InMemoryLoyaltyRepository,
  buildTestConfig,
} from '../support/fakes';

describe('LoyaltyService read/list helpers', () => {
  let repo: InMemoryLoyaltyRepository;
  let service: LoyaltyService;

  beforeEach(() => {
    repo = new InMemoryLoyaltyRepository();
    service = new LoyaltyService(repo, buildTestConfig(), new InMemoryCustomerDirectory());
  });

  it('getTiers exposes the domain tier table', () => {
    expect(service.getTiers()).toBe(TIER_BENEFITS);
  });

  it('countMembers counts enrolled accounts', async () => {
    await service.getAccount('c1');
    await service.getAccount('c2');
    expect(await service.countMembers()).toBe(2);
  });

  it('listTransactions clamps page below 1 and limit above the max', async () => {
    await service.earnForOrder('c1', 'ord-1', 60000);
    const page = await service.listTransactions('c1', 0, 9999);
    expect(page.page).toBe(1); // clamped up from 0
    expect(page.limit).toBe(100); // clamped down from 9999
    expect(page.total).toBe(1);
    expect(page.totalPages).toBe(1);
  });

  it('listTransactions uses defaults and returns an empty page for an unknown customer', async () => {
    const page = await service.listTransactions('nobody');
    expect(page).toMatchObject({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 });
  });

  it('runExpiry skips a lot whose account no longer exists', async () => {
    // Orphan EARN lot: expirable, but no matching account → the `!account` continue path.
    repo.txns.push({
      id: 'orphan-lot',
      customerId: 'ghost',
      type: PointsTxnType.EARN,
      points: 50,
      orderId: null,
      reason: 'orphan',
      expiresAt: new Date('2020-01-01'),
      expired: false,
      createdAt: new Date('2019-01-01'),
    });
    const result = await service.runExpiry(new Date());
    expect(result.lotsExpired).toBe(1); // lot was found...
    expect(result.pointsExpired).toBe(0); // ...but skipped (no account to debit)
  });
});

describe('pagination.buildPage', () => {
  it('computes totalPages, flooring an empty set to at least one page', () => {
    expect(buildPage([], 0, 1, 20)).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(buildPage(['a'], 45, 2, 20)).toMatchObject({ totalPages: 3 });
  });
});

describe('domain errors', () => {
  it('each error carries its code and HTTP status', () => {
    expect(new LoyaltyAccountNotFoundError()).toMatchObject({
      code: 'LOYALTY_ACCOUNT_NOT_FOUND',
      status: 404,
    });
    expect(new InvalidAdjustmentError()).toMatchObject({
      code: 'LOYALTY_INVALID_ADJUSTMENT',
      status: 400,
    });
    expect(new InvalidAdjustmentError('custom').message).toBe('custom');
    expect(new RewardItemNotFoundError()).toMatchObject({
      code: 'LOYALTY_REWARD_NOT_FOUND',
      status: 404,
    });
    expect(new InsufficientPointsError()).toMatchObject({
      code: 'LOYALTY_INSUFFICIENT_POINTS',
      status: 422,
    });
    expect(new RewardOutOfStockError()).toMatchObject({
      code: 'LOYALTY_REWARD_OUT_OF_STOCK',
      status: 422,
    });
  });
});

describe('membership.benefitFor fallback', () => {
  it('falls back to the REGULAR row for an unknown tier', () => {
    expect(benefitFor('BOGUS' as MembershipTier)).toBe(TIER_BENEFITS[0]);
  });
});
