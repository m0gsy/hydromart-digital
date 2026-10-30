import { randomUUID } from 'node:crypto';

import { StaleOrderStatusError } from '../../src/domain/errors';
import { OrderStatus } from '../../src/domain/order-status';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { OutboxPrismaRepository } from '../../src/infrastructure/prisma/outbox.prisma.repository';
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

describeRace('outbox rows on real Postgres — a late sweep result vs. a void', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let outbox: OutboxPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    outbox = new OutboxPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const row = (status = 'PENDING') =>
    prisma.outboxMessage.create({ data: { topic: 'INVENTORY_CONSUME', orderId: randomUUID(), status } });

  it('markDone and markFailed never revive or close a row the void already CANCELLED', async () => {
    const a = await row('CANCELLED');
    const b = await row('CANCELLED');
    await outbox.markDone(a.id);
    await outbox.markFailed(b.id, 'late', new Date());
    expect((await prisma.outboxMessage.findUnique({ where: { id: a.id } }))!.status).toBe('CANCELLED');
    const bAfter = (await prisma.outboxMessage.findUnique({ where: { id: b.id } }))!;
    expect(bAfter.status).toBe('CANCELLED');
    expect(bAfter.attempts).toBe(0);
  });

  it('cancel racing markDone: the row ends in exactly one terminal state, never PENDING', async () => {
    for (let i = 0; i < 20; i++) {
      const r = await row();
      await race([() => outbox.cancelForOrder(r.orderId, 'void'), () => outbox.markDone(r.id)]);
      const status = (await prisma.outboxMessage.findUnique({ where: { id: r.id } }))!.status;
      expect(['DONE', 'CANCELLED']).toContain(status);
    }
  });

  it('markFailed on a DONE row does not push it back to PENDING', async () => {
    const r = await row('DONE');
    await outbox.markFailed(r.id, 'late', new Date());
    expect((await prisma.outboxMessage.findUnique({ where: { id: r.id } }))!.status).toBe('DONE');
  });
});
