import { randomUUID } from 'node:crypto';

import { MembershipTier } from '../../src/domain/membership';
import { PointsTxnType } from '../../src/domain/points';
import { LoyaltyAccountRecord } from '../../src/application/ports/loyalty.repository';
import { LoyaltyService } from '../../src/application/services/loyalty.service';
import { InMemoryCustomerDirectory, InMemoryLoyaltyRepository, buildTestConfig } from '../support/fakes';

const account = (customerId: string, tier: MembershipTier, pointsBalance: number): LoyaltyAccountRecord => ({
  id: randomUUID(),
  customerId,
  tier,
  pointsBalance,
  lifetimePoints: pointsBalance,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

const redeem = (customerId: string, pointsSpent: number, createdAt: Date) => ({
  id: randomUUID(),
  customerId,
  type: PointsTxnType.REDEEM,
  points: -pointsSpent,
  orderId: null,
  reason: 'redeem',
  expiresAt: null,
  expired: false,
  createdAt,
});

describe('LoyaltyService.depotSummary', () => {
  const now = new Date('2026-07-18T12:00:00Z'); // month start = 2026-07-01 UTC

  it('aggregates tiers, outstanding points, and this-month redemptions over the depot customers only', async () => {
    const repo = new InMemoryLoyaltyRepository();
    // In-depot customers.
    repo.accounts.push(
      account('c1', MembershipTier.GOLD, 500),
      account('c2', MembershipTier.SILVER, 300),
      account('c3', MembershipTier.GOLD, 200),
    );
    // Out-of-depot customer — must be ignored.
    repo.accounts.push(account('other', MembershipTier.PLATINUM, 9999));

    repo.txns.push(
      redeem('c1', 100, new Date('2026-07-05T00:00:00Z')), // this month → counts
      redeem('c2', 40, new Date('2026-07-10T00:00:00Z')), // this month → counts
      redeem('c1', 70, new Date('2026-06-30T00:00:00Z')), // last month → excluded
      redeem('other', 500, new Date('2026-07-06T00:00:00Z')), // out-of-depot → excluded
    );

    const directory = new InMemoryCustomerDirectory(['c1', 'c2', 'c3']);
    const service = new LoyaltyService(repo, buildTestConfig(), directory);

    const summary = await service.depotSummary('depot-1', now);

    expect(summary).toEqual({
      depotId: 'depot-1',
      totalMembers: 3,
      pointsOutstanding: 1000, // 500 + 300 + 200
      redeemedThisMonth: 140, // 100 + 40 (June + out-of-depot excluded)
      tiers: { REGULAR: 0, SILVER: 1, GOLD: 2, PLATINUM: 0 },
    });
  });

  it('returns a zeroed summary without aggregating when the depot has no customers', async () => {
    const repo = new InMemoryLoyaltyRepository();
    repo.accounts.push(account('other', MembershipTier.GOLD, 500)); // exists but not in depot
    const service = new LoyaltyService(repo, buildTestConfig(), new InMemoryCustomerDirectory([]));

    const summary = await service.depotSummary('depot-empty', now);

    expect(summary).toEqual({
      depotId: 'depot-empty',
      totalMembers: 0,
      pointsOutstanding: 0,
      redeemedThisMonth: 0,
      tiers: { REGULAR: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 },
    });
  });
});
