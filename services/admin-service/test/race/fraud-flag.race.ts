import { randomUUID } from 'node:crypto';

import { FraudFlagAlreadyOpenError } from '../../src/domain/errors';
import { FraudEntityType, FraudLevel, FraudStatus } from '../../src/domain/fraud';
import { FraudFlagPrismaRepository } from '../../src/infrastructure/prisma/fraud-flag.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('fraud flags on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: FraudFlagPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new FraudFlagPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const data = (entityRef: string) => ({
    entityType: FraudEntityType.ACCOUNT,
    entityRef,
    score: 4,
    level: FraudLevel.MEDIUM,
    signals: ['x'],
  });

  it('the migration installed the one-open-per-entity index on a clean table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'fraud_flags_one_open_per_entity'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('six simultaneous scans of one customer raise exactly one flag', async () => {
    for (let i = 0; i < 5; i++) {
      const ref = randomUUID();
      const res = await race(Array.from({ length: 6 }, () => () => repo.create(data(ref))));
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of res.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(FraudFlagAlreadyOpenError);
      }
      expect(await prisma.fraudFlag.count({ where: { entityRef: ref } })).toBe(1);
    }
  });

  it('a decided flag does not stop the customer being flagged again', async () => {
    const ref = randomUUID();
    const first = await repo.create(data(ref));
    await repo.setStatus(first.id, FraudStatus.REVIEWED, null);
    await expect(repo.create(data(ref))).resolves.toBeDefined();
  });

  it('two flags on one account cleared at once: exactly one of them reinstates', async () => {
    for (let i = 0; i < 10; i++) {
      const ref = randomUUID();
      const a = await repo.create(data(ref));
      await repo.setStatus(a.id, FraudStatus.BLOCKED, null);
      const b = await repo.create(data(ref));
      await repo.setStatus(b.id, FraudStatus.BLOCKED, null);
      const res = await race([() => repo.clear(a.id, null), () => repo.clear(b.id, null)]);
      const outs = res.map((r) => (r as PromiseFulfilledResult<{ reinstate: boolean }>).value);
      expect(outs.filter((o) => o.reinstate)).toHaveLength(1);
    }
  });
});
