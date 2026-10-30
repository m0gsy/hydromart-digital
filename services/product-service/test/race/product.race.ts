import { randomUUID } from 'node:crypto';

import { StaleWriteError } from '@hydromart/platform';

import { ProductPrismaRepository } from '../../src/infrastructure/prisma/product.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('product writes on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: ProductPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new ProductPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const product = () =>
    prisma.product.create({
      data: { name: 'Galon', sku: `SKU-${randomUUID()}`, unit: 'galon', basePrice: 20_000 },
    });

  it('two editors holding the same stamp: one lands, the other gets a stale-write', async () => {
    for (let i = 0; i < 20; i++) {
      const p = await product();
      const res = await race([
        () => repo.update(p.id, { name: 'A' }, p.updatedAt),
        () => repo.update(p.id, { name: 'B' }, p.updatedAt),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        StaleWriteError,
      );
    }
  });

  it('two price edits from the same read: one trail row, and it names the price that was replaced', async () => {
    for (let i = 0; i < 20; i++) {
      const p = await product();
      const res = await race(
        [21_000, 22_000].map((to) => () =>
          repo.updateWithPriceAudit(
            p.id,
            { basePrice: to },
            { changedBy: randomUUID(), fromPrice: 20_000, toPrice: to },
            p.updatedAt,
          ),
        ),
      );
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const trail = await prisma.productPriceChange.findMany({ where: { productId: p.id } });
      expect(trail).toHaveLength(1);
      const now = (await prisma.product.findUnique({ where: { id: p.id } }))!;
      expect(Number(trail[0].toPrice)).toBe(Number(now.basePrice));
    }
  });
});
