import { randomUUID } from 'node:crypto';

import { AiEngagementPrismaRepository } from '../../src/infrastructure/prisma/ai-engagement.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H4 part 2: the AI read API's discount and subscription reads against a real Postgres: orders
 * that count (not cancelled, not voided), the half-open instants of a depot span, a decimal discount
 * sum, and distinct subscribers.
 */
describeRace('AI engagement reads against a real database', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AiEngagementPrismaRepository;
  const depotA = randomUUID();
  const depotB = randomUUID();
  const from = new Date('2026-09-30T17:00:00.000Z');
  const to = new Date('2026-10-31T17:00:00.000Z');

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AiEngagementPrismaRepository(prisma as never);
  });
  afterAll(async () => drop());

  const order = (depotId: string, status: string, discount: number, createdAt: Date) =>
    prisma.order.create({
      data: {
        orderNumber: `HM-${randomUUID()}`,
        customerId: randomUUID(),
        status: status as never,
        depotId,
        subtotal: 20_000,
        deliveryFee: 5_000,
        discount,
        total: 25_000 - discount,
        recipientName: 'Budi',
        phone: '0811',
        addressLine: 'Jl. Merdeka 10',
        city: 'Bandung',
        createdAt,
      },
    });

  it('sums the discount of orders that count inside the depot spans, at the half-open edges', async () => {
    await order(depotA, 'COMPLETED', 1500.5, from); // exactly at the start: in
    await order(depotA, 'DELIVERED', 0, new Date('2026-10-10T03:00:00Z'));
    await order(depotA, 'CANCELLED', 9000, new Date('2026-10-11T03:00:00Z'));
    await order(depotA, 'VOIDED', 9000, new Date('2026-10-12T03:00:00Z'));
    await order(depotA, 'COMPLETED', 700, to); // exactly at the end: out
    await order(depotB, 'COMPLETED', 400, new Date('2026-10-05T03:00:00Z')); // before B is readable
    await order(depotB, 'COMPLETED', 300, new Date('2026-10-20T03:00:00Z'));
    const out = await repo.discounts([
      { depotId: depotA, from, to },
      { depotId: depotB, from: new Date('2026-10-14T17:00:00.000Z'), to },
    ]);
    expect(out).toEqual({ orders: 3, discountedOrders: 2, discountIdr: 1800.5 });
    await expect(repo.discounts([])).resolves.toEqual({ orders: 0, discountedOrders: 0, discountIdr: 0 });
  });

  it('counts the plans made inside a window and the distinct customers behind them', async () => {
    const [c1, c2] = [randomUUID(), randomUUID()];
    const plan = (customerId: string, createdAt: Date) =>
      prisma.subscription.create({
        data: {
          customerId,
          productId: randomUUID(),
          productName: 'Galon',
          unit: 'galon',
          quantity: 1,
          frequency: 'WEEKLY',
          nextDeliveryAt: new Date('2026-12-01T00:00:00Z'),
          recipientName: 'Budi',
          phone: '0811',
          addressLine: 'Jl. 1',
          city: 'Bandung',
          createdAt,
        },
      });
    await plan(c1, from);
    await plan(c1, new Date('2026-10-02T00:00:00Z'));
    await plan(c2, new Date('2026-10-30T00:00:00Z'));
    await plan(c2, to);
    await expect(repo.newSubscriptions(from, to)).resolves.toEqual({ subscriptions: 3, subscribers: 2 });
    await expect(repo.newSubscriptions(new Date('2020-01-01T00:00:00Z'), new Date('2020-02-01T00:00:00Z'))).resolves.toEqual({
      subscriptions: 0,
      subscribers: 0,
    });
  });
});
