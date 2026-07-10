import { randomUUID } from 'node:crypto';

import { InvalidAdjustmentError } from '../../src/domain/errors';
import { MembershipTier } from '../../src/domain/membership';
import { PointsTxnType } from '../../src/domain/points';
import { LoyaltyService } from '../../src/application/services/loyalty.service';
import { InMemoryLoyaltyRepository, buildTestConfig } from '../support/fakes';

describe('LoyaltyService', () => {
  let repo: InMemoryLoyaltyRepository;
  let service: LoyaltyService;

  beforeEach(() => {
    repo = new InMemoryLoyaltyRepository();
    service = new LoyaltyService(repo, buildTestConfig());
  });

  it('lazily creates a REGULAR account on first read', async () => {
    const account = await service.getAccount('cust-1');
    expect(account).toMatchObject({ tier: MembershipTier.REGULAR, pointsBalance: 0, lifetimePoints: 0 });
    expect(repo.accounts).toHaveLength(1);
  });

  it('awards floor(subtotal / rate) points on a completed order (BR-013)', async () => {
    const result = await service.earnForOrder('cust-1', randomUUID(), 60000);
    expect(result.pointsEarned).toBe(60);
    expect(result.alreadyEarned).toBe(false);
    expect(result.account.pointsBalance).toBe(60);
    expect(result.account.lifetimePoints).toBe(60);
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

  it('sweeps expired lots into negative EXPIRE entries (BR-014)', async () => {
    // Earn with an already-past expiry so the lot is immediately due.
    const expired = new LoyaltyService(repo, buildTestConfig({ LOYALTY_POINT_EXPIRY_MONTHS: '-1' }));
    await expired.earnForOrder('cust-1', randomUUID(), 60000); // 60 pts, expiry in the past

    const result = await service.runExpiry(new Date());
    expect(result.lotsExpired).toBe(1);
    expect(result.pointsExpired).toBe(60);

    const account = await service.getAccount('cust-1');
    expect(account.pointsBalance).toBe(0);
    expect(repo.txns.some((t) => t.type === PointsTxnType.EXPIRE && t.points === -60)).toBe(true);
  });

  it('does not re-expire an already swept lot', async () => {
    const expired = new LoyaltyService(repo, buildTestConfig({ LOYALTY_POINT_EXPIRY_MONTHS: '-1' }));
    await expired.earnForOrder('cust-1', randomUUID(), 60000);
    await service.runExpiry(new Date());
    const second = await service.runExpiry(new Date());
    expect(second.lotsExpired).toBe(0);
  });
});
