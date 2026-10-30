import { randomUUID } from 'node:crypto';

import { LoyaltyService } from '../../src/application/services/loyalty.service';
import { LoyaltyPrismaRepository } from '../../src/infrastructure/prisma/loyalty.prisma.repository';
import { InMemoryCustomerDirectory, buildTestConfig } from '../support/fakes';
import { describeRace, freshPrisma, race } from './db';

describeRace('loyalty rewards on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let service: LoyaltyService;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    service = new LoyaltyService(
      new LoyaltyPrismaRepository(prisma as never),
      buildTestConfig(),
      new InMemoryCustomerDirectory(),
    );
  });
  afterAll(async () => drop?.());

  it('six simultaneous birthday sweeps for one customer grant the points once', async () => {
    for (let i = 0; i < 5; i++) {
      const customerId = randomUUID();
      await service.getAccount(customerId);
      const res = await race(
        Array.from({ length: 6 }, () => () =>
          service.reward(customerId, 100, 'Birthday reward 2026', 'birthday:2026'),
        ),
      );
      expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
      expect((await service.getAccount(customerId)).pointsBalance).toBe(100);
      expect(await prisma.pointsTransaction.count({ where: { customerId, type: 'REWARD' } })).toBe(1);
    }
  });

  it('rewards without a key are never merged, and a new year is a new reward', async () => {
    const customerId = randomUUID();
    await service.getAccount(customerId);
    await service.reward(customerId, 10, 'bonus');
    await service.reward(customerId, 10, 'bonus');
    await service.reward(customerId, 100, 'Birthday reward 2026', 'birthday:2026');
    await service.reward(customerId, 100, 'Birthday reward 2027', 'birthday:2027');
    expect((await service.getAccount(customerId)).pointsBalance).toBe(220);
  });
});
