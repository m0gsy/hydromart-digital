import { randomUUID } from 'node:crypto';

import { StaleOrderStatusError } from '../../src/domain/errors';
import { OrderStatus } from '../../src/domain/order-status';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('order status writes on real Postgres — cancel vs. staff', () => {
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

  const order = (status: string) =>
    prisma.order.create({
      data: {
        orderNumber: `HM-${randomUUID()}`,
        customerId: randomUUID(),
        status: status as never,
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
  const reversalRows = (orderId: string) =>
    prisma.outboxMessage.count({ where: { orderId, topic: 'PAYMENT_REVERSAL' } });

  it('a cancel racing staff moving the order on: one wins, and the reversal is owed only if the cancel won', async () => {
    for (let i = 0; i < 25; i++) {
      const o = await order('CONFIRMED');

      const [cancel, advance] = await race([
        () =>
          repo.applyStatus(
            o.id,
            OrderStatus.CONFIRMED,
            OrderStatus.CANCELLED,
            o.customerId,
            'ganti hari',
            undefined,
            undefined,
            undefined,
            [{ topic: 'PAYMENT_REVERSAL', orderId: o.id }],
          ),
        () => repo.applyStatus(o.id, OrderStatus.CONFIRMED, OrderStatus.DRIVER_ASSIGNED, 'staff', null),
      ]);

      const final = (await prisma.order.findUnique({ where: { id: o.id } }))!;
      // Exactly one of the two writes wins; the loser is told, with the typed error.
      expect([cancel.status, advance.status].sort()).toEqual(['fulfilled', 'rejected']);
      const loser = cancel.status === 'rejected' ? cancel : advance;
      expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(StaleOrderStatusError);
      if (cancel.status === 'fulfilled') {
        expect(final.status).toBe('CANCELLED');
        expect(await reversalRows(o.id)).toBe(1);
      } else {
        // Staff won: the order is live, and NO reversal is owed — the money was never touched.
        expect(final.status).toBe('DRIVER_ASSIGNED');
        expect(await reversalRows(o.id)).toBe(0);
      }
    }
  });

  it('a lost cancel rolls its outbox row back with it', async () => {
    const o = await order('DRIVER_ASSIGNED');

    await expect(
      repo.applyStatus(
        o.id,
        OrderStatus.CONFIRMED, // stale: the order has moved on
        OrderStatus.CANCELLED,
        o.customerId,
        null,
        undefined,
        undefined,
        undefined,
        [{ topic: 'PAYMENT_REVERSAL', orderId: o.id }],
      ),
    ).rejects.toBeInstanceOf(StaleOrderStatusError);

    expect(await reversalRows(o.id)).toBe(0);
  });
});
