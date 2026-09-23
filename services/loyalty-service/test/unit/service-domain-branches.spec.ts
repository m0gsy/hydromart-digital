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
    expect(service.getTiers()).toEqual([...TIER_BENEFITS]);
  });

  it('countMembers counts enrolled accounts', async () => {
    await service.getAccount('c1');
    await service.getAccount('c2');
    expect(await service.countMembers()).toBe(2);
  });

  // LOY-9 + LOY-4: a depot-scoped caller sees its own depots' customers and nobody else.
  it('counts and reads members only inside the given depots', async () => {
    const scoped = new LoyaltyService(
      repo,
      buildTestConfig(),
      new InMemoryCustomerDirectory([], { d1: ['c1'], d2: ['c1', 'c3'] }),
    );
    await scoped.getAccount('c1');
    await scoped.getAccount('c2');
    await scoped.getAccount('c3');
    expect(await scoped.countMembers(['d1', 'd2'])).toBe(2);
    expect(await scoped.countMembers(['d9'])).toBe(0);
    await expect(scoped.getAccountInScope('c3', ['d2'])).resolves.toMatchObject({
      customerId: 'c3',
    });
    await expect(scoped.getAccountInScope('c2', ['d1', 'd2'])).rejects.toThrow(
      'bukan pelanggan depot Anda',
    );
    expect((await scoped.getAccountInScope('c2')).customerId).toBe('c2');
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
    // PAR-01: the sweep ships off, so this case builds one with the switch explicitly on.
    // Asserting the orphan-lot branch against a disabled sweep would assert nothing.
    const sweeper = new LoyaltyService(
      repo,
      buildTestConfig({ LOYALTY_POINT_EXPIRY_SWEEP_ENABLED: '1' }),
      new InMemoryCustomerDirectory(),
    );
    const result = await sweeper.runExpiry(new Date());
    // LOY-8: the count is what the sweep actually expired, not what it looked at. A lot
    // with no account behind it is debited from nothing, and reporting it as expired is
    // how a sweep that took no points reads as a sweep that worked.
    expect(result.lotsExpired).toBe(0);
    expect(result.pointsExpired).toBe(0);
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

  /*
   * LOY-8: the two ways a due lot takes nothing — its points were already spent, and
   * another sweep claimed it first. Both used to debit anyway: the first for the full lot
   * (eating a later lot's points), the second a second time for the same lot.
   */
  it('closes a lot whose points were already spent, without debiting', async () => {
    const repo = new InMemoryLoyaltyRepository();
    const account = await repo.createAccount('cust-1');
    repo.txns.push({
      id: 'spent-lot',
      customerId: 'cust-1',
      type: PointsTxnType.EARN,
      points: 50,
      orderId: null,
      reason: 'spent',
      expiresAt: new Date('2020-01-01'),
      expired: false,
      createdAt: new Date('2019-01-01'),
    });
    expect(account.pointsBalance).toBe(0); // the lot's points are long gone
    const sweeper = new LoyaltyService(
      repo,
      buildTestConfig({ LOYALTY_POINT_EXPIRY_SWEEP_ENABLED: '1' }),
      new InMemoryCustomerDirectory(),
    );
    const result = await sweeper.runExpiry(new Date());
    expect(result).toMatchObject({ lotsExpired: 0, pointsExpired: 0 });
    // Closed all the same, or every later sweep would find it again forever.
    expect(repo.txns.find((t) => t.id === 'spent-lot')?.expired).toBe(true);
  });

  it('counts nothing for a lot another sweep claimed first', async () => {
    const repo = new InMemoryLoyaltyRepository();
    await repo.createAccount('cust-1');
    await repo.recordAdjustment({
      type: PointsTxnType.REWARD,
      accountId: (await repo.findAccount('cust-1'))!.id,
      customerId: 'cust-1',
      points: 100,
      reason: 'seed',
      lifetimeDelta: 100,
    });
    repo.txns.push({
      id: 'raced-lot',
      customerId: 'cust-1',
      type: PointsTxnType.EARN,
      points: 50,
      orderId: null,
      reason: 'raced',
      expiresAt: new Date('2020-01-01'),
      expired: false,
      createdAt: new Date('2019-01-01'),
    });
    // The other sweep wins the claim between this one's read and its write.
    jest.spyOn(repo, 'recordExpiry').mockResolvedValueOnce(false);
    const sweeper = new LoyaltyService(
      repo,
      buildTestConfig({ LOYALTY_POINT_EXPIRY_SWEEP_ENABLED: '1' }),
      new InMemoryCustomerDirectory(),
    );
    await expect(sweeper.runExpiry(new Date())).resolves.toMatchObject({
      lotsExpired: 0,
      pointsExpired: 0,
    });
  });
});
