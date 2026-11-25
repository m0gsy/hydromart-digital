import { randomUUID } from 'node:crypto';

import { AiLoyaltyPrismaRepository } from '../../src/infrastructure/prisma/ai-loyalty.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H4 part 2: the AI read API's loyalty reads against a real Postgres: the half-open instants of a
 * span (a redemption handed over exactly at the start is in, exactly at the end is out), only handed-over
 * redemptions, one person who redeems twice counted once, the depot-less ones disclosed, and the ledger
 * and the accounts as they stood before an instant.
 */
describeRace('AI loyalty reads against a real database', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AiLoyaltyPrismaRepository;
  const depotA = randomUUID();
  const depotB = randomUUID();
  const from = new Date('2026-09-30T17:00:00.000Z');
  const to = new Date('2026-10-31T17:00:00.000Z');

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AiLoyaltyPrismaRepository(prisma as never);
  });
  afterAll(async () => drop());

  it('counts redemptions handed over inside the spans, once per person, and discloses the ones with no depot', async () => {
    const reward = await prisma.rewardItem.create({ data: { name: 'Galon gratis', unit: 'galon', pointsCost: 100 } });
    const [p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID()];
    const redeem = (customerId: string, status: string, depotId: string | null, usedAt: Date | null, pointsSpent = 100) =>
      prisma.rewardRedemption.create({
        data: { rewardItemId: reward.id, customerId, pointsSpent, idempotencyKey: randomUUID(), status, depotId, usedAt },
      });
    await redeem(p1, 'USED', depotA, from); // exactly at the start: in
    await redeem(p1, 'USED', depotA, new Date('2026-10-10T03:00:00Z'), 50); // the same person again
    await redeem(p2, 'USED', depotB, new Date('2026-10-20T03:00:00Z'));
    await redeem(p3, 'USED', depotA, to); // exactly at the end: out
    await redeem(p3, 'ACTIVE', depotA, null); // not handed over
    await redeem(p3, 'CANCELLED', depotA, null);
    await redeem(p3, 'USED', depotB, new Date('2026-10-05T03:00:00Z')); // depot B, but B is only read from 15 Oct
    await redeem(p3, 'USED', null, new Date('2026-10-12T03:00:00Z')); // no depot recorded

    const out = await repo.redemptions([
      { depotId: depotA, from, to },
      { depotId: depotB, from: new Date('2026-10-14T17:00:00.000Z'), to },
    ]);
    expect(out).toEqual({ redemptions: 3, points: 250, redeemers: 2, unplaced: 1 });
    await expect(repo.redemptions([])).resolves.toEqual({ redemptions: 0, points: 0, redeemers: 0, unplaced: 0 });
  });

  it('sums the ledger and counts the accounts that existed before an instant', async () => {
    const mk = async (createdAt: Date, points: number[]) => {
      const customerId = randomUUID();
      const account = await prisma.loyaltyAccount.create({ data: { customerId, createdAt } });
      for (const [i, p] of points.entries()) {
        await prisma.pointsTransaction.create({
          data: { accountId: account.id, customerId, type: p > 0 ? 'EARN' : 'REDEEM', points: p, createdAt: new Date(createdAt.getTime() + i * 1000) },
        });
      }
    };
    await mk(new Date('2026-08-01T00:00:00Z'), [100, -30]);
    await mk(new Date('2026-10-31T16:59:59Z'), [50]);
    await mk(new Date('2026-10-31T17:00:00Z'), [999]); // at the instant: not before it
    const out = await repo.pointsOutstanding(to);
    expect(out.accounts).toBeGreaterThanOrEqual(2);
    const before = await repo.pointsOutstanding(new Date('2026-09-01T00:00:00Z'));
    expect(before).toEqual({ accounts: 1, points: 70 });
    expect(out.points - before.points).toBe(50);
    await expect(repo.pointsOutstanding(new Date('2020-01-01T00:00:00Z'))).resolves.toEqual({ accounts: 0, points: 0 });
  });
});
