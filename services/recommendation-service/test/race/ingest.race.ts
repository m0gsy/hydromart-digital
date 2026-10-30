import { randomUUID } from 'node:crypto';

import { RecommendationPrismaRepository } from '../../src/infrastructure/prisma/recommendation.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('recommendation ingest on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: RecommendationPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new RecommendationPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const at = new Date('2026-10-20T03:00:00Z');
  const item = (productId: string) => ({ productId, productName: 'Galon', sku: `S-${productId.slice(0, 6)}`, unit: 'galon' });

  it.each([
    ['a depot-less order', null],
    ['an order at a depot', randomUUID()],
  ])('twenty-four simultaneous ingests for %s: one daily-sales row, every order counted, none rolled back', async (_n, depotId) => {
    const productId = randomUUID();
    const res = await race(
      Array.from({ length: 24 }, () => () =>
        repo.applyIngest({ orderId: randomUUID(), customerId: randomUUID(), depotId, items: [item(productId)], at }),
      ),
    );
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await prisma.productDailySales.findMany({ where: { productId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(24);
  });
});
