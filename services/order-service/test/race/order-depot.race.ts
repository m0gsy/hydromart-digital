import { randomUUID } from 'node:crypto';

import { OrderStatus } from '../../src/domain/order-status';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('order depot routing on real Postgres', () => {
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

  const order = (status: string, depotId: string | null) =>
    prisma.order.create({
      data: {
        orderNumber: `HM-${randomUUID()}`,
        customerId: randomUUID(),
        status: status as never,
        depotId,
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
  const depotOf = async (id: string) => (await prisma.order.findUnique({ where: { id } }))!.depotId;

  it('two operators routing one blank order: exactly one wins and the depot is the winner’s', async () => {
    for (let i = 0; i < 25; i++) {
      const o = await order('CREATED', null);
      const [a, b] = [randomUUID(), randomUUID()];
      const res = await race([
        () => repo.assignDepotIf(o.id, null, null, a),
        () => repo.assignDepotIf(o.id, null, null, b),
      ]);
      const won = res.map((r) => (r as PromiseFulfilledResult<unknown>).value).filter(Boolean);
      expect(won).toHaveLength(1);
      expect([a, b]).toContain(await depotOf(o.id));
    }
  });

  it('two reroutes from the same depot: exactly one lands', async () => {
    for (let i = 0; i < 25; i++) {
      const from = randomUUID();
      const o = await order('CONFIRMED', from);
      const allowed = [OrderStatus.CREATED, OrderStatus.CONFIRMED, OrderStatus.PREPARING];
      const res = await race([
        () => repo.assignDepotIf(o.id, from, allowed, randomUUID()),
        () => repo.assignDepotIf(o.id, from, allowed, randomUUID()),
      ]);
      expect(res.map((r) => (r as PromiseFulfilledResult<unknown>).value).filter(Boolean)).toHaveLength(1);
    }
  });
});
