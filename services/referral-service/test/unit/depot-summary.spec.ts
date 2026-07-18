import { randomUUID } from 'node:crypto';

import { ReferralService } from '../../src/application/services/referral.service';
import {
  FakeCustomerDirectory,
  FakeLoyaltyReward,
  InMemoryReferralRepository,
  buildTestConfig,
} from '../support/fakes';

/**
 * depotSummary aggregates referrals over the depot's customers (as referrers). These specs
 * drive the fake customer directory + in-memory aggregate: conversion math, top-referrer
 * ordering, and the empty-ids (no customers / directory fail-open) short-circuit to zeros.
 */
describe('ReferralService.depotSummary', () => {
  let repo: InMemoryReferralRepository;
  let service: ReferralService;
  const depotId = randomUUID();

  // Seed: 3 referrers under one depot. A: 2 qualified, B: 1 qualified, C: 1 pending (not qualified).
  const referrerA = randomUUID();
  const referrerB = randomUUID();
  const referrerC = randomUUID();

  async function seed(): Promise<void> {
    const codeA = (await service.getOrCreateMyCode(referrerA)).code;
    const codeB = (await service.getOrCreateMyCode(referrerB)).code;
    const codeC = (await service.getOrCreateMyCode(referrerC)).code;

    // A: two qualified referrals -> 2 * 500 = 1000 pts
    for (let i = 0; i < 2; i += 1) {
      const referee = randomUUID();
      await service.redeem(referee, codeA);
      await service.qualify(referee, randomUUID(), '');
    }
    // B: one qualified referral -> 500 pts
    const refB = randomUUID();
    await service.redeem(refB, codeB);
    await service.qualify(refB, randomUUID(), '');
    // C: one PENDING referral (invited but not qualified)
    await service.redeem(randomUUID(), codeC);
  }

  function build(idsByDepot: Record<string, string[]>): void {
    repo = new InMemoryReferralRepository();
    service = new ReferralService(
      repo,
      new FakeLoyaltyReward(),
      new FakeCustomerDirectory(idsByDepot),
      buildTestConfig(),
    );
  }

  it('aggregates invited/qualified/points, computes rounded conversion, orders top referrers desc', async () => {
    build({ [depotId]: [referrerA, referrerB, referrerC] });
    await seed();

    const summary = await service.depotSummary(depotId);

    // invited = all referrals (2 A qualified + 1 B qualified + 1 C pending) = 4; qualified = 3.
    expect(summary).toMatchObject({
      depotId,
      invited: 4,
      qualified: 3,
      pointsAwarded: 1500, // 3 qualified * 500
      conversionPct: 75, // round(3/4*100)
    });
    // Ordered by qualified-referral count desc: A(2) before B(1); C has none -> absent.
    expect(summary.topReferrers).toEqual([
      { customerId: referrerA, referralCount: 2, pointsEarned: 1000 },
      { customerId: referrerB, referralCount: 1, pointsEarned: 500 },
    ]);
  });

  it('rounds conversion (2/3 -> 67) and excludes referrers outside the depot', async () => {
    build({ [depotId]: [referrerA, referrerB] }); // C not in this depot
    // A: 1 qualified + 1 pending ; B: 1 qualified  => invited 3, qualified 2
    const codeA = (await service.getOrCreateMyCode(referrerA)).code;
    const codeB = (await service.getOrCreateMyCode(referrerB)).code;
    const q = randomUUID();
    await service.redeem(q, codeA);
    await service.qualify(q, randomUUID(), '');
    await service.redeem(randomUUID(), codeA); // pending
    const qb = randomUUID();
    await service.redeem(qb, codeB);
    await service.qualify(qb, randomUUID(), '');

    const summary = await service.depotSummary(depotId);
    expect(summary.invited).toBe(3);
    expect(summary.qualified).toBe(2);
    expect(summary.conversionPct).toBe(67); // round(2/3*100 = 66.67)
  });

  it('returns zeros (no query) when the depot has no customers / directory fails open', async () => {
    build({}); // directory yields [] for this depot
    await service.getOrCreateMyCode(referrerA); // data exists but not scoped to depot

    const summary = await service.depotSummary(depotId);
    expect(summary).toEqual({
      depotId,
      invited: 0,
      qualified: 0,
      conversionPct: 0,
      pointsAwarded: 0,
      topReferrers: [],
    });
  });
});
