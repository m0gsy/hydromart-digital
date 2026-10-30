import { randomUUID } from 'node:crypto';

import { GallonIssuePrismaRepository } from '../../src/infrastructure/prisma/gallon-issue.prisma.repository';
import { OPENING_BALANCE_NOTE } from '../../src/application/ports/gallon-issue.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('opening gallon balances on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: GallonIssuePrismaRepository;
  let depotId: string;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new GallonIssuePrismaRepository(prisma as never);
    depotId = (
      await prisma.depot.create({
        data: {
          code: `D-${randomUUID().slice(0, 8)}`,
          name: 'Depot',
          ownershipType: 'HKP' as never,
          address: 'Jl. 1',
          city: 'Bandung',
          province: 'Jabar',
          lat: -6.9,
          lng: 107.6,
          deliveryFee: 5000,
        },
      })
    ).id;
  });
  afterAll(async () => drop?.());

  it('the same file uploaded six times at once books each customer\'s opening balance once', async () => {
    for (let i = 0; i < 5; i++) {
      const customerId = randomUUID();
      const data = {
        depotId,
        customerId,
        quantity: 3,
        depositHeld: 60_000,
        note: OPENING_BALANCE_NOTE,
        actorId: 'staff',
      };
      const res = await race(Array.from({ length: 6 }, () => () => repo.createOpeningOnce(data)));
      const outs = res.map((r) => (r as PromiseFulfilledResult<{ created: boolean }>).value);
      expect(outs.filter((o) => o.created)).toHaveLength(1);
      expect(await prisma.gallonIssue.count({ where: { depotId, customerId } })).toBe(1);
    }
  });
});
