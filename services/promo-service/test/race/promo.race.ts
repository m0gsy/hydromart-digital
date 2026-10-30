import { randomUUID } from 'node:crypto';

import { StaleWriteError } from '@hydromart/platform';

import { PromotionPrismaRepository } from '../../src/infrastructure/prisma/promotion.prisma.repository';
import { VoucherPrismaRepository } from '../../src/infrastructure/prisma/voucher.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('promo edits on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
  });
  afterAll(async () => drop?.());

  it('two editors of one promotion holding the same stamp: one lands, one is stale', async () => {
    const repo = new PromotionPrismaRepository(prisma as never);
    for (let i = 0; i < 20; i++) {
      const p = await prisma.promotion.create({ data: { title: 'T' } });
      await new Promise((r) => setTimeout(r, 5)); // updatedAt is a millisecond CAS token
      const res = await race([
        () => repo.update(p.id, { title: 'A' }, p.updatedAt),
        () => repo.update(p.id, { title: 'B' }, p.updatedAt),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        StaleWriteError,
      );
    }
  });

  it('two editors of one voucher holding the same stamp: one lands, one is stale', async () => {
    const repo = new VoucherPrismaRepository(prisma as never);
    for (let i = 0; i < 20; i++) {
      const v = await prisma.voucher.create({
        data: { code: `V${randomUUID().slice(0, 8)}`, discountType: 'PERCENTAGE' as never, value: 10 },
      });
      await new Promise((r) => setTimeout(r, 5)); // updatedAt is a millisecond CAS token
      const res = await race([
        () => repo.update(v.id, { value: 11 }, v.updatedAt),
        () => repo.update(v.id, { value: 12 }, v.updatedAt),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }
  });
});
