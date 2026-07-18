import {
  InsufficientPointsError,
  RewardItemNotFoundError,
  RewardOutOfStockError,
} from '../../src/domain/errors';
import { PointsTxnType } from '../../src/domain/points';
import { LoyaltyService } from '../../src/application/services/loyalty.service';
import { RewardService } from '../../src/application/services/reward.service';
import {
  InMemoryCustomerDirectory,
  InMemoryLoyaltyRepository,
  InMemoryRewardRepository,
  buildTestConfig,
} from '../support/fakes';

const CUSTOMER = '11111111-1111-1111-1111-111111111111';

describe('RewardService', () => {
  let loyaltyRepo: InMemoryLoyaltyRepository;
  let rewardRepo: InMemoryRewardRepository;
  let service: RewardService;

  beforeEach(() => {
    loyaltyRepo = new InMemoryLoyaltyRepository();
    rewardRepo = new InMemoryRewardRepository(loyaltyRepo);
    const loyalty = new LoyaltyService(loyaltyRepo, buildTestConfig(), new InMemoryCustomerDirectory());
    service = new RewardService(rewardRepo, loyalty);
  });

  /** Give the customer a starting balance via a system reward grant. */
  async function seedBalance(points: number): Promise<void> {
    const loyalty = new LoyaltyService(loyaltyRepo, buildTestConfig(), new InMemoryCustomerDirectory());
    await loyalty.reward(CUSTOMER, points, 'seed');
  }

  it('lists only active catalog items', async () => {
    rewardRepo.seedItem({ id: 'a', pointsCost: 100, active: true });
    rewardRepo.seedItem({ id: 'b', pointsCost: 200, active: false });
    expect(await service.listCatalog()).toHaveLength(2 - 1);
  });

  it('redeems an item, debiting the balance without touching lifetime points', async () => {
    await seedBalance(1000);
    rewardRepo.seedItem({ id: 'gal', pointsCost: 800, name: 'Galon' });

    const result = await service.redeem(CUSTOMER, 'gal', 'key-1');

    expect(result.pointsBalance).toBe(200);
    const acc = await loyaltyRepo.findAccount(CUSTOMER);
    expect(acc?.pointsBalance).toBe(200);
    expect(acc?.lifetimePoints).toBe(1000); // spend never lowers lifetime/tier
    const redeemTxn = loyaltyRepo.txns.find((t) => t.type === PointsTxnType.REDEEM);
    expect(redeemTxn?.points).toBe(-800);
  });

  it('is idempotent: a repeat with the same key does not debit twice', async () => {
    await seedBalance(1000);
    rewardRepo.seedItem({ id: 'gal', pointsCost: 800 });

    const first = await service.redeem(CUSTOMER, 'gal', 'key-1');
    const second = await service.redeem(CUSTOMER, 'gal', 'key-1');

    expect(second.redemption.id).toBe(first.redemption.id);
    expect((await loyaltyRepo.findAccount(CUSTOMER))?.pointsBalance).toBe(200);
    expect(rewardRepo.redemptions).toHaveLength(1);
  });

  it('rejects a redemption when the balance is too low', async () => {
    await seedBalance(100);
    rewardRepo.seedItem({ id: 'gal', pointsCost: 800 });
    await expect(service.redeem(CUSTOMER, 'gal', 'key-1')).rejects.toBeInstanceOf(
      InsufficientPointsError,
    );
  });

  it('rejects a redemption for an out-of-stock item', async () => {
    await seedBalance(5000);
    rewardRepo.seedItem({ id: 'disp', pointsCost: 100, stock: 0 });
    await expect(service.redeem(CUSTOMER, 'disp', 'key-1')).rejects.toBeInstanceOf(
      RewardOutOfStockError,
    );
  });

  it('rejects an unknown or inactive item', async () => {
    await seedBalance(5000);
    rewardRepo.seedItem({ id: 'off', pointsCost: 100, active: false });
    await expect(service.redeem(CUSTOMER, 'off', 'key-1')).rejects.toBeInstanceOf(
      RewardItemNotFoundError,
    );
    await expect(service.redeem(CUSTOMER, 'missing', 'key-2')).rejects.toBeInstanceOf(
      RewardItemNotFoundError,
    );
  });

  it('decrements finite stock on redeem', async () => {
    await seedBalance(1000);
    rewardRepo.seedItem({ id: 'seg', pointsCost: 100, stock: 3 });
    await service.redeem(CUSTOMER, 'seg', 'key-1');
    expect((await rewardRepo.findItem('seg'))?.stock).toBe(2);
  });
});
