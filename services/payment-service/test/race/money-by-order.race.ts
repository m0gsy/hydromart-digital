import { randomUUID } from 'node:crypto';

import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import { PaymentPrismaRepository } from '../../src/infrastructure/prisma/payment.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H2: the three raw queries behind GET payments/internal/depot-money, on a real Postgres. The
 * unit specs only see the SQL text; this proves the casts, the naive-UTC window, the depot filter
 * and the kept-amount arithmetic actually run and answer.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const window = { from: new Date('2026-10-31T17:00:00.000Z'), to: new Date('2026-11-30T17:00:00.000Z') };
const aging = { asOf: new Date('2026-11-25T05:00:00.000Z'), tz: 'Asia/Jakarta', maxDays: [1, 3, 7] };

describeRace('PaymentPrismaRepository.moneyByOrder on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: PaymentPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new PaymentPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const pay = (o: Record<string, unknown>) =>
    prisma.payment.create({
      data: {
        orderId: randomUUID(),
        customerId: randomUUID(),
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
        amount: 100_000,
        paidAt: new Date('2026-11-10T03:00:00.000Z'),
        ...o,
      } as never,
    });

  it('collected: kept amount by paid instant, counter only for the depots asked, delivery network-wide', async () => {
    const edge = await pay({ depotId: D1, paidAt: new Date('2026-11-30T16:30:00.000Z') }); // 23:30 WIB last day: in
    await pay({ depotId: D1, paidAt: new Date('2026-11-30T17:10:00.000Z') }); // 00:10 WIB next day: out
    await pay({ depotId: D2 }); // another depot's drawer: not asked for
    const delivery = await pay({ amount: 50_000 }); // no depot of its own: read, placed later
    const part = await pay({ depotId: D1, status: PaymentStatus.REFUNDED, amount: 40_000, refundedAmount: 15_000, refundedAt: new Date('2026-11-12T03:00:00.000Z') });
    await pay({ depotId: D1, status: PaymentStatus.REFUNDED, amount: 9_000, refundedAmount: null, refundedAt: new Date('2026-11-12T03:00:00.000Z') });
    const rows = await repo.moneyByOrder('collected', window, 100, aging, [D1]);
    const by = (id: string) => rows.find((r) => r.orderId === id);
    expect(by(edge.orderId)).toMatchObject({ counterDepotId: D1, amountIdr: 100_000, count: 1 });
    expect(by(delivery.orderId)).toMatchObject({ counterDepotId: null, amountIdr: 50_000 });
    expect(by(part.orderId)?.amountIdr).toBe(25_000);
    expect(rows).toHaveLength(3); // edge, delivery, part: not the late one, not D2, not the fully refunded
    // the cap is on rows read
    expect(await repo.moneyByOrder('collected', window, 2, aging, [D1])).toHaveLength(2);
  });

  it('pending: aged in WIB calendar days into the buckets', async () => {
    await pay({ depotId: D1, status: PaymentStatus.PENDING, paidAt: null, createdAt: new Date('2026-11-25T04:00:00.000Z'), amount: 10_000 });
    await pay({ depotId: D1, status: PaymentStatus.PENDING, paidAt: null, createdAt: new Date('2026-11-12T04:00:00.000Z'), amount: 20_000 });
    const rows = await repo.moneyByOrder('pending', window, 100, aging, [D1]);
    const bucketOf = (amount: number) => rows.find((r) => r.amountIdr === amount)?.bucket;
    expect(bucketOf(10_000)).toBe(0); // today
    expect(bucketOf(20_000)).toBe(3); // 13 days: past the last boundary
  });

  it('refunded: settled refunds by refund instant, at the refunded part', async () => {
    const a = await pay({ depotId: D1, status: PaymentStatus.REFUNDED, amount: 40_000, refundedAmount: 15_000, refundedAt: new Date('2026-11-20T03:00:00.000Z'), refundSettledAt: new Date('2026-11-20T03:01:00.000Z') });
    await pay({ depotId: D1, status: PaymentStatus.REFUNDED, amount: 7_000, refundedAmount: null, refundedAt: new Date('2026-12-02T03:00:00.000Z'), refundSettledAt: new Date('2026-12-02T03:01:00.000Z') });
    const rows = await repo.moneyByOrder('refunded', window, 100, aging, [D1]);
    expect(rows.filter((r) => r.orderId === a.orderId)).toEqual([expect.objectContaining({ amountIdr: 15_000 })]);
    expect(rows.every((r) => r.counterDepotId === D1 || r.counterDepotId === null)).toBe(true);
  });

  it('an empty depot list still reads delivery payments (they have no depot of their own)', async () => {
    const rows = await repo.moneyByOrder('collected', window, 100, aging, []);
    expect(rows.every((r) => r.counterDepotId === null)).toBe(true);
  });
});
