import {
  InsufficientPointsError,
  RewardAlreadyCancelledError,
  RewardAlreadyUsedError,
  RewardItemNotFoundError,
  RewardOutOfStockError,
  RewardRedemptionNotFoundError,
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
    const loyalty = new LoyaltyService(
      loyaltyRepo,
      buildTestConfig(),
      new InMemoryCustomerDirectory(),
    );
    service = new RewardService(rewardRepo, loyalty);
  });

  /** Give the customer a starting balance via a system reward grant. */
  async function seedBalance(points: number): Promise<void> {
    const loyalty = new LoyaltyService(
      loyaltyRepo,
      buildTestConfig(),
      new InMemoryCustomerDirectory(),
    );
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

  describe('catalogue management', () => {
    it('lists retired items that the customer catalogue hides', async () => {
      rewardRepo.seedItem({ id: 'live', pointsCost: 100 });
      rewardRepo.seedItem({ id: 'gone', pointsCost: 100, active: false });
      expect(await service.listCatalog()).toHaveLength(1);
      expect(await service.listAll()).toHaveLength(2);
    });

    it('creates an item that then shows in the catalogue', async () => {
      const created = await service.createItem({
        name: 'Galon gratis',
        unit: 'gratis 1 galon',
        pointsCost: 500,
        imageUrl: null,
        stock: 10,
        active: true,
      });
      expect(created.id).toBeDefined();
      expect(await service.listCatalog()).toHaveLength(1);
    });

    it('retires an item with active:false so it leaves the catalogue', async () => {
      const created = await service.createItem({
        name: 'Galon gratis',
        unit: 'gratis 1 galon',
        pointsCost: 500,
        imageUrl: null,
        stock: null,
        active: true,
      });
      const updated = await service.updateItem(created.id, { active: false });
      expect(updated.active).toBe(false);
      expect(await service.listCatalog()).toHaveLength(0);
    });

    it('rejects an update to an item that does not exist', async () => {
      await expect(service.updateItem('missing', { stock: 5 })).rejects.toBeInstanceOf(
        RewardItemNotFoundError,
      );
    });
  });

  describe('cancel (M14-03)', () => {
    async function redeemOne(stock: number | null = 3) {
      await seedBalance(1000);
      rewardRepo.seedItem({ id: 'gal', pointsCost: 800, name: 'Galon', stock });
      return service.redeem(CUSTOMER, 'gal', 'key-1');
    }

    it('gives the points back and puts the stock on the shelf again', async () => {
      const { redemption } = await redeemOne();
      expect((await rewardRepo.findItem('gal'))!.stock).toBe(2);

      const out = await service.cancel(CUSTOMER, redemption.id);

      expect(out.pointsBalance).toBe(1000);
      expect(out.redemption.status).toBe('CANCELLED');
      expect(out.redemption.cancelledAt).not.toBeNull();
      expect((await rewardRepo.findItem('gal'))!.stock).toBe(3);
      // The refund is a ledger entry, not a silent balance edit.
      const credits = loyaltyRepo.txns.filter(
        (t) => t.type === PointsTxnType.REDEEM && t.points > 0,
      );
      expect(credits).toHaveLength(1);
      expect(credits[0].points).toBe(800);
    });

    it('refuses once staff marked the reward as handed over', async () => {
      const { redemption } = await redeemOne();
      await service.markUsed(redemption.id);

      await expect(service.cancel(CUSTOMER, redemption.id)).rejects.toBeInstanceOf(
        RewardAlreadyUsedError,
      );
      // No refund leaked through: stock stays consumed and no credit entry exists.
      expect((await rewardRepo.findItem('gal'))!.stock).toBe(2);
      expect(
        loyaltyRepo.txns.filter((t) => t.type === PointsTxnType.REDEEM && t.points > 0),
      ).toHaveLength(0);
    });

    it('refuses a second cancellation instead of minting points', async () => {
      const { redemption } = await redeemOne();
      await service.cancel(CUSTOMER, redemption.id);

      await expect(service.cancel(CUSTOMER, redemption.id)).rejects.toBeInstanceOf(
        RewardAlreadyCancelledError,
      );
      const account = await rewardRepo.findRedemption(redemption.id);
      expect(account!.status).toBe('CANCELLED');
    });

    it("will not let one customer cancel another's redemption", async () => {
      const { redemption } = await redeemOne();
      await expect(
        service.cancel('22222222-2222-2222-2222-222222222222', redemption.id),
      ).rejects.toBeInstanceOf(RewardRedemptionNotFoundError);
    });

    it('reports an unknown redemption as missing', async () => {
      await expect(service.cancel(CUSTOMER, 'nope')).rejects.toBeInstanceOf(
        RewardRedemptionNotFoundError,
      );
    });

    it('cancels an unlimited-stock reward without touching any counter', async () => {
      const { redemption } = await redeemOne(null);
      const out = await service.cancel(CUSTOMER, redemption.id);
      expect(out.redemption.status).toBe('CANCELLED');
      expect((await rewardRepo.findItem('gal'))!.stock).toBeNull();
    });
  });

  describe('markUsed (M14-03)', () => {
    async function redeemOne() {
      await seedBalance(1000);
      rewardRepo.seedItem({ id: 'gal', pointsCost: 800, name: 'Galon', stock: 3 });
      return service.redeem(CUSTOMER, 'gal', 'key-1');
    }

    it('closes the cancellation window and is idempotent', async () => {
      const { redemption } = await redeemOne();
      const first = await service.markUsed(redemption.id);
      expect(first.status).toBe('USED');
      expect(first.usedAt).not.toBeNull();

      const again = await service.markUsed(redemption.id);
      expect(again.usedAt).toEqual(first.usedAt); // no second stamp
    });

    it('cannot hand over a redemption that was already cancelled', async () => {
      const { redemption } = await redeemOne();
      await service.cancel(CUSTOMER, redemption.id);
      await expect(service.markUsed(redemption.id)).rejects.toBeInstanceOf(
        RewardAlreadyCancelledError,
      );
    });

    it('reports an unknown redemption as missing', async () => {
      await expect(service.markUsed('nope')).rejects.toBeInstanceOf(RewardRedemptionNotFoundError);
    });
  });
});
