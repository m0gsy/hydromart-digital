import { randomUUID } from 'node:crypto';

import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('recordRefund on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: OrderPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new OrderPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const order = () =>
    prisma.order.create({
      data: {
        orderNumber: `HM-${randomUUID()}`,
        customerId: randomUUID(),
        subtotal: 20_000,
        deliveryFee: 5_000,
        discount: 0,
        total: 25_000,
        recipientName: 'Budi',
        phone: '0811',
        addressLine: 'Jl. Merdeka 10',
        city: 'Bandung',
      },
    });
  const stored = async (id: string) =>
    Number((await prisma.order.findUnique({ where: { id } }))!.refundedAmount);

  it('two identical concurrent notices: exactly one sees the total rise', async () => {
    for (let i = 0; i < 20; i++) {
      const o = await order();
      const res = await race([() => repo.recordRefund(o.id, 20_000), () => repo.recordRefund(o.id, 20_000)]);
      const before = res.map((r) => (r as PromiseFulfilledResult<number>).value).sort((a, b) => a - b);
      // The winner saw 0 (so 20.000 is new), the loser saw 20.000 (nothing new).
      expect(before).toEqual([0, 20_000]);
      expect(await stored(o.id)).toBe(20_000);
    }
  });

  it('only ever raises, and reports the previous total', async () => {
    const o = await order();
    expect(await repo.recordRefund(o.id, 15_000)).toBe(0);
    expect(await repo.recordRefund(o.id, 24_000)).toBe(15_000);
    expect(await repo.recordRefund(o.id, 15_000)).toBe(15_000); // late notice: no change
    expect(await stored(o.id)).toBe(24_000);
  });
});
