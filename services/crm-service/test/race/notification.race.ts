import { randomUUID } from 'node:crypto';

import { NotificationPrismaRepository } from '../../src/infrastructure/prisma/notification.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('notifications on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: NotificationPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new NotificationPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const data = (dedupeKey: string | null) =>
    ({
      event: 'ORDER_RECEIVED',
      customerId: null,
      phone: '+6281',
      message: 'm',
      status: 'SENT',
      error: null,
      destination: null,
      depotId: null,
      dedupeKey,
    }) as never;

  it('six simultaneous sends of one keyed notification: one row, the rest see it was a repeat', async () => {
    for (let i = 0; i < 5; i++) {
      const key = `k-${randomUUID()}`;
      const res = await race(Array.from({ length: 6 }, () => () => repo.recordOnce(data(key))));
      const outs = res.map((r) => (r as PromiseFulfilledResult<{ created: boolean }>).value);
      expect(outs.filter((o) => o.created)).toHaveLength(1);
      expect(await prisma.notification.count({ where: { dedupeKey: key } })).toBe(1);
    }
  });

  it('notifications without a key are never merged', async () => {
    const before = await prisma.notification.count();
    await Promise.all([repo.recordOnce(data(null)), repo.recordOnce(data(null))]);
    expect(await prisma.notification.count()).toBe(before + 2);
  });
});
