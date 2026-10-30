import { randomUUID } from 'node:crypto';

import { ForecastPrismaRepository } from '../../src/infrastructure/prisma/forecast.prisma.repository';
import { toBusinessDay } from '../../src/domain/series';
import { describeRace, freshPrisma, race } from './db';

describeRace('forecast ingest on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: ForecastPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new ForecastPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const at = new Date('2026-10-20T03:00:00Z');
  const order = (depotId: string | null, productId: string) => ({
    orderId: randomUUID(),
    customerId: randomUUID(),
    depotId,
    total: 25_000,
    items: [{ productId, productName: 'Galon', sku: `SKU-${productId.slice(0, 6)}`, unit: 'galon', quantity: 2 }],
    at,
  });

  it.each([
    ['a depot-less order', null],
    ['an order at a depot', randomUUID()],
  ])('twenty-four simultaneous ingests for %s: one revenue row per day, every order counted, none rolled back', async (_n, depotId) => {
    const day = toBusinessDay(at, 'Asia/Jakarta');
    const res = await race(Array.from({ length: 24 }, () => () => repo.applyIngest(order(depotId, randomUUID()), day)));
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    // Different products share the depot's daily revenue row - the cell that find-then-create raced on.
    expect(await prisma.productDailyDemand.count({ where: { depotId } })).toBe(24);
    const revenue = await prisma.depotDailyRevenue.findMany({ where: { depotId } });
    expect(revenue).toHaveLength(1);
    expect(revenue[0].orderCount).toBe(24);
    expect(revenue[0].revenue).toBe(600_000);
  });
});
