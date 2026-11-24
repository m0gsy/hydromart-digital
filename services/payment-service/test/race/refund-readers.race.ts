import { randomUUID } from 'node:crypto';

import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import { PaymentPrismaRepository } from '../../src/infrastructure/prisma/payment.prisma.repository';
import { describeRace, freshPrisma } from './db';

// HD-6 A3: the readers behind shift cash, COD expected and the payment-method numbers must keep
// counting what stayed of a part-refunded payment, on real SQL.
describeRace('payment readers after a part-refund (real Postgres)', () => {
  let drop: () => Promise<void>;
  let repo: PaymentPrismaRepository;
  let db: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  const customer = randomUUID();
  const depot = randomUUID();
  const at = new Date('2026-08-03T03:00:00.000Z');
  const range = { from: new Date('2026-08-03T01:00:00.000Z'), to: new Date('2026-08-03T09:00:00.000Z') };

  beforeAll(async () => {
    const d = await freshPrisma();
    drop = d.drop;
    db = d.prisma;
    repo = new PaymentPrismaRepository(d.prisma as never);
  });
  afterAll(async () => drop?.());

  const add = (
    orderId: string,
    amount: number,
    status: PaymentStatus,
    refundedAmount: number | null,
    extra: Record<string, unknown> = {},
  ) =>
    db.payment.create({
      data: {
        orderId,
        customerId: customer,
        method: PaymentMethod.CASH,
        status,
        amount,
        paidAt: at,
        createdAt: at,
        refundedAmount,
        refundedAt: refundedAmount === null && status !== PaymentStatus.REFUNDED ? null : at,
        refundSettledAt: status === PaymentStatus.REFUNDED ? at : null,
        depotId: depot,
        ...extra,
      } as never,
    });

  it('counts paid whole, part-refunded for the rest, full refund for nothing, never negative', async () => {
    const o1 = randomUUID(); // part-refund then a second payment
    const o2 = randomUUID(); // two part-refunds
    const o3 = randomUUID(); // full refund
    const o4 = randomUUID(); // paid, untouched
    await add(o1, 45_000, PaymentStatus.REFUNDED, 20_000);
    await add(o1, 10_000, PaymentStatus.PAID, null);
    await add(o2, 30_000, PaymentStatus.REFUNDED, 10_000);
    await add(o2, 30_000, PaymentStatus.REFUNDED, 5_000);
    await add(o3, 50_000, PaymentStatus.REFUNDED, 50_000);
    await add(o3, 8_000, PaymentStatus.REFUNDED, null); // no stated amount = full
    await add(o4, 7_000, PaymentStatus.PAID, null);
    await add(randomUUID(), 5_000, PaymentStatus.REFUNDED, 9_000); // over-refund clamps to 0

    const byOrder = new Map(
      (await repo.cashByOrder([o1, o2, o3, o4])).map((r) => [r.orderId, r.amountIdr]),
    );
    expect(byOrder.get(o1)).toBe(25_000 + 10_000);
    expect(byOrder.get(o2)).toBe(20_000 + 25_000);
    expect(byOrder.has(o3)).toBe(false);
    expect(byOrder.get(o4)).toBe(7_000);

    const kept = 35_000 + 45_000 + 7_000;
    expect(await repo.sumDepotCash(depot, range)).toEqual({ total: kept, count: 5 });
    // A shift id: own drawer plus the unattributed ones.
    await db.payment.updateMany({ where: { orderId: o4 }, data: { cashierShiftId: 'shift-x' } });
    expect(await repo.sumDepotCash(depot, range, 'shift-x')).toEqual({ total: kept, count: 5 });
    expect(
      await repo.sumDepotCash(depot, { from: range.to, to: new Date('2026-08-04') }, 'shift-x'),
    ).toEqual({ total: 7_000, count: 1 });

    const byMethod = await repo.aggregateRevenueByMethod({});
    expect(byMethod).toEqual([{ method: PaymentMethod.CASH, amount: kept, count: 5 }]);

    // refundedTotalForOrder: only settled rows; a stated part counts as stated.
    expect(await repo.refundedTotalForOrder(o1)).toBe(20_000);
    expect(await repo.refundedTotalForOrder(o2)).toBe(15_000);
    // A NULL part is a FULL refund here too, the same as in the readers above.
    expect(await repo.refundedTotalForOrder(o3)).toBe(50_000 + 8_000);
    // A row claimed but not yet settled (gateway pending) is not counted.
    const o5 = randomUUID();
    await add(o5, 40_000, PaymentStatus.REFUNDED, 9_000, { refundSettledAt: null });
    expect(await repo.refundedTotalForOrder(o5)).toBe(0);
    await db.payment.updateMany({ where: { orderId: o5 }, data: { refundSettledAt: at } });
    expect(await repo.refundedTotalForOrder(o5)).toBe(9_000);
  });
});
