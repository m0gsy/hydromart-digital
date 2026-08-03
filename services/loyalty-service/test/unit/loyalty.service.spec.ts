import { randomUUID } from 'node:crypto';

import { SettingRow } from '@hydromart/platform';

import { InvalidAdjustmentError } from '../../src/domain/errors';
import { MembershipTier } from '../../src/domain/membership';
import { PointsTxnType } from '../../src/domain/points';
import { LoyaltyService } from '../../src/application/services/loyalty.service';
import {
  InMemoryCustomerDirectory,
  InMemoryLoyaltyRepository,
  buildTestConfig,
  buildTestConfigWithSettings,
} from '../support/fakes';

describe('LoyaltyService', () => {
  let repo: InMemoryLoyaltyRepository;
  let service: LoyaltyService;

  beforeEach(() => {
    repo = new InMemoryLoyaltyRepository();
    service = new LoyaltyService(repo, buildTestConfig(), new InMemoryCustomerDirectory());
  });

  it('lazily creates a REGULAR account on first read', async () => {
    const account = await service.getAccount('cust-1');
    expect(account).toMatchObject({
      tier: MembershipTier.REGULAR,
      pointsBalance: 0,
      lifetimePoints: 0,
    });
    expect(repo.accounts).toHaveLength(1);
  });

  it('awards floor(subtotal / rate) points on a completed order (BR-013)', async () => {
    const result = await service.earnForOrder('cust-1', randomUUID(), 60000);
    expect(result.pointsEarned).toBe(60);
    expect(result.alreadyEarned).toBe(false);
    expect(result.account.pointsBalance).toBe(60);
    expect(result.account.lifetimePoints).toBe(60);
  });

  describe('reverseEarnForOrder', () => {
    it('takes back exactly what that order earned', async () => {
      const orderId = randomUUID();
      await service.earnForOrder('cust-1', orderId, 60000);

      const account = await service.reverseEarnForOrder('cust-1', orderId, 'Konter dibatalkan');

      expect(account.pointsBalance).toBe(0);
      expect(repo.txns.filter((t) => t.type === PointsTxnType.ADJUST)).toHaveLength(1);
    });

    // An anonymous counter sale, or one below the earn threshold, never awarded anything.
    // Reversing it is a no-op, not an error — the void must not fail on it.
    it('is a no-op for an order that never earned', async () => {
      await service.earnForOrder('cust-1', randomUUID(), 60000);
      const account = await service.reverseEarnForOrder('cust-1', randomUUID(), 'Batal');
      expect(account.pointsBalance).toBe(60);
      expect(repo.txns.filter((t) => t.type === PointsTxnType.ADJUST)).toHaveLength(0);
    });
  });

  it('is idempotent per order — a repeat earn is a no-op', async () => {
    const orderId = randomUUID();
    await service.earnForOrder('cust-1', orderId, 60000);
    const again = await service.earnForOrder('cust-1', orderId, 60000);
    expect(again.alreadyEarned).toBe(true);
    expect(again.pointsEarned).toBe(0);
    expect(again.account.pointsBalance).toBe(60);
    expect(repo.txns.filter((t) => t.type === PointsTxnType.EARN)).toHaveLength(1);
  });

  it('upgrades the tier once lifetime points cross a threshold', async () => {
    const result = await service.earnForOrder('cust-1', randomUUID(), 1_000_000);
    expect(result.pointsEarned).toBe(1000);
    expect(result.account.tier).toBe(MembershipTier.SILVER);
  });

  it('records nothing for a sub-threshold order but still reads as handled', async () => {
    const result = await service.earnForOrder('cust-1', randomUUID(), 500);
    expect(result.pointsEarned).toBe(0);
    expect(repo.txns).toHaveLength(0);
  });

  it('rejects an adjustment that would drive the balance negative', async () => {
    await service.earnForOrder('cust-1', randomUUID(), 60000); // balance 60
    await expect(service.adjust('cust-1', -100, 'over-refund')).rejects.toBeInstanceOf(
      InvalidAdjustmentError,
    );
  });

  it('applies a positive adjustment to balance and lifetime', async () => {
    const account = await service.adjust('cust-1', 250, 'goodwill');
    expect(account.pointsBalance).toBe(250);
    expect(account.lifetimePoints).toBe(250);
  });

  it('grants a flat REWARD toward balance and lifetime (referral bonus)', async () => {
    const account = await service.reward('cust-1', 500, 'Referral reward');
    expect(account.pointsBalance).toBe(500);
    expect(account.lifetimePoints).toBe(500);
    expect(repo.txns.some((t) => t.type === PointsTxnType.REWARD && t.points === 500)).toBe(true);
  });

  it('upgrades the tier when a REWARD crosses a threshold', async () => {
    const account = await service.reward('cust-1', 1000, 'Big referral');
    expect(account.tier).toBe(MembershipTier.SILVER);
  });

  it('sweeps expired lots into negative EXPIRE entries (BR-014)', async () => {
    // Earn with an already-past expiry so the lot is immediately due.
    const expired = new LoyaltyService(
      repo,
      buildTestConfig({ LOYALTY_POINT_EXPIRY_MONTHS: '-1' }),
      new InMemoryCustomerDirectory(),
    );
    await expired.earnForOrder('cust-1', randomUUID(), 60000); // 60 pts, expiry in the past

    const result = await service.runExpiry(new Date());
    expect(result.lotsExpired).toBe(1);
    expect(result.pointsExpired).toBe(60);

    const account = await service.getAccount('cust-1');
    expect(account.pointsBalance).toBe(0);
    expect(repo.txns.some((t) => t.type === PointsTxnType.EXPIRE && t.points === -60)).toBe(true);
  });

  it('does not re-expire an already swept lot', async () => {
    const expired = new LoyaltyService(
      repo,
      buildTestConfig({ LOYALTY_POINT_EXPIRY_MONTHS: '-1' }),
      new InMemoryCustomerDirectory(),
    );
    await expired.earnForOrder('cust-1', randomUUID(), 60000);
    await service.runExpiry(new Date());
    const second = await service.runExpiry(new Date());
    expect(second.lotsExpired).toBe(0);
  });
});

describe('LoyaltyService standing under a per-depot ladder', () => {
  // depot-1 makes GOLD harder to reach (9000) and cheaper to honour (3%).
  const rows: SettingRow[] = [
    { scope: 'DEPOT', depotId: 'depot-1', key: 'goldThreshold', value: '9000' },
    { scope: 'DEPOT', depotId: 'depot-1', key: 'goldDiscountPct', value: '3' },
  ];
  let repo: InMemoryLoyaltyRepository;
  let service: LoyaltyService;

  beforeEach(async () => {
    repo = new InMemoryLoyaltyRepository();
    service = new LoyaltyService(
      repo,
      await buildTestConfigWithSettings(rows),
      new InMemoryCustomerDirectory(),
    );
    // 6.000.000 rupiah at the default 1 pt / Rp 1.000 = 6000 lifetime points.
    await service.earnForOrder('cust-1', randomUUID(), 6_000_000);
  });

  it('answers the global ladder when no depot is named', async () => {
    const standing = await service.getStanding('cust-1');
    expect(standing.tier).toBe(MembershipTier.GOLD);
    expect(standing.discountRate).toBe(0.05);
  });

  it('re-derives tier and rate against the named depot ladder', async () => {
    const standing = await service.getStanding('cust-1', 'depot-1');
    expect(standing.tier).toBe(MembershipTier.SILVER);
    expect(standing.discountRate).toBe(0.02);
  });

  it("leaves the stored tier on the customer's global standing", async () => {
    // Earning happened with depot-1 supplied; the card must still read GOLD, because a
    // stricter depot's opinion is not the customer's network-wide tier.
    await service.earnForOrder('cust-1', randomUUID(), 1000, 'depot-1');
    const { account } = await service.getStanding('cust-1', 'depot-1');
    expect(account.tier).toBe(MembershipTier.GOLD);
  });

  it('scopes the published ladder to the depot', async () => {
    const gold = (depotId: string | null) =>
      service.getTiers(depotId).find((b) => b.tier === MembershipTier.GOLD);
    expect(gold('depot-1')).toMatchObject({ threshold: 9000, discountRate: 0.03 });
    expect(gold(null)).toMatchObject({ threshold: 5000, discountRate: 0.05 });
  });
});
