import { randomUUID } from 'node:crypto';

import { AiCustomerPrismaRepository } from '../../src/infrastructure/prisma/ai-customer.prisma.repository';
import { ANONYMOUS_CUSTOMER_ID } from '../../src/domain/anonymous';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H3 on a real Postgres: the customer, rating and gallon reads of the AI read API. The SQL is
 * written against naive-UTC timestamp columns and spans of instants, so the edges that matter are
 * checked here: 23:30 WIB on the last day is in, 00:10 WIB on the next is out; a depot that changes
 * hands mid-period counts only for the days of its span; the anonymous counter buyer is nobody.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const FROM = new Date('2026-10-31T17:00:00.000Z'); // 1 Nov 00:00 WIB
const TO = new Date('2026-11-30T17:00:00.000Z'); // 1 Dec 00:00 WIB
const span = (depotId: string, from = FROM, to = TO) => ({ depotId, from, to });

describeRace('HD-6 H3 customer and gallon reads on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AiCustomerPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AiCustomerPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const order = async (o: {
    customerId: string;
    depotId: string;
    at: string;
    status?: string;
    walkIn?: boolean;
    gallons?: number;
    empties?: number | null;
  }) =>
    prisma.order.create({
      data: {
        orderNumber: `HM-${randomUUID()}`,
        customerId: o.customerId,
        depotId: o.depotId,
        status: (o.status ?? 'COMPLETED') as never,
        isWalkIn: o.walkIn ?? false,
        emptiesReturned: o.empties ?? null,
        subtotal: 20_000,
        deliveryFee: 0,
        discount: 0,
        total: 20_000,
        recipientName: 'x',
        phone: '0811',
        addressLine: 'x',
        city: 'x',
        createdAt: new Date(o.at),
        ...(o.gallons
          ? {
              items: {
                create: [
                  {
                    productId: randomUUID(),
                    productName: 'Galon',
                    sku: 'G',
                    unit: 'galon',
                    isGallon: true,
                    unitPrice: 10_000,
                    quantity: o.gallons,
                    lineTotal: 10_000 * o.gallons,
                  },
                ],
              },
            }
          : {}),
      } as never,
    });

  it('counts new, active and repeat customers at the span edges, per depot and with the counter buyer excluded', async () => {
    const [newHere, repeater, oldGuy, outsider, cancelled] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await order({ customerId: newHere, depotId: D1, at: '2026-11-30T16:30:00.000Z' }); // 23:30 WIB 30 Nov: in
    await order({ customerId: repeater, depotId: D1, at: '2026-10-01T03:00:00.000Z' }); // before the period
    await order({ customerId: repeater, depotId: D1, at: '2026-11-05T03:00:00.000Z' });
    await order({ customerId: oldGuy, depotId: D2, at: '2026-09-01T03:00:00.000Z' }); // first order at D2, long ago
    await order({ customerId: oldGuy, depotId: D1, at: '2026-11-06T03:00:00.000Z' }); // first at D1 now, but not new to the network
    await order({ customerId: outsider, depotId: D1, at: '2026-11-30T17:10:00.000Z' }); // 00:10 WIB 1 Dec: out
    await order({ customerId: cancelled, depotId: D1, at: '2026-11-07T03:00:00.000Z', status: 'CANCELLED' });
    await order({ customerId: ANONYMOUS_CUSTOMER_ID, depotId: D1, at: '2026-11-08T03:00:00.000Z', walkIn: true });
    const stats = await repo.customerWindow([span(D1)], FROM);
    expect(stats.active).toBe(3); // newHere, repeater, oldGuy
    expect(stats.newCustomers).toBe(1); // newHere only
    expect(stats.repeat).toBe(2); // repeater and oldGuy ordered before the period
    expect(stats.newAtDepot).toEqual([{ depotId: D1, customers: 2 }]); // newHere, and oldGuy's first order AT D1
  });

  it('reads a depot only for the days of its span (a change of legal entity mid-period)', async () => {
    const mid = new Date('2026-11-15T17:00:00.000Z'); // 16 Nov 00:00 WIB
    const early = randomUUID();
    const late = randomUUID();
    await order({ customerId: early, depotId: D2, at: '2026-11-10T03:00:00.000Z' });
    await order({ customerId: late, depotId: D2, at: '2026-11-20T03:00:00.000Z' });
    const second = await repo.customerWindow([span(D2, mid, TO)], FROM);
    // oldGuy's 6 Nov order at D1 is not here; at D2 only the 20 Nov order is in the span
    expect(second.active).toBe(1);
    expect(second.newCustomers).toBe(1);
    const both = await repo.customerWindow([span(D2, FROM, mid), span(D2, mid, TO)], FROM);
    expect(both.active).toBe(2);
  });

  it('files cohorts by the month of the first order and counts only activity inside the spans', async () => {
    const cells = await repo.customerCohorts([span(D1)], 'Asia/Jakarta');
    // Customers whose first order anywhere is in a D1 span: newHere (Nov); repeater's first was October, outside
    expect(cells).toEqual([{ cohort: '2026-11', monthIndex: 0, customers: 1 }]);
  });

  it('counts reviews and distinct reviewers of orders in the spans, never the counter buyer', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const o1 = await order({ customerId: a, depotId: D1, at: '2026-11-09T03:00:00.000Z' });
    const o2 = await order({ customerId: a, depotId: D1, at: '2026-11-10T03:00:00.000Z' });
    const o3 = await order({ customerId: b, depotId: D1, at: '2026-11-11T03:00:00.000Z' });
    const o4 = await order({ customerId: ANONYMOUS_CUSTOMER_ID, depotId: D1, at: '2026-11-11T03:00:00.000Z', walkIn: true });
    for (const [o, rating, cust] of [
      [o1, 5, a],
      [o2, 4, a],
      [o3, 3, b],
      [o4, 1, ANONYMOUS_CUSTOMER_ID],
    ] as const) {
      await prisma.orderReview.create({ data: { orderId: o.id, customerId: cust, rating } });
    }
    await expect(repo.ratingStats([span(D1)])).resolves.toEqual({ reviews: 3, ratingSum: 12, reviewers: 2 });
  });

  it('buckets customers by days since their last order, as of the end of a day', async () => {
    const until = new Date('2026-11-30T17:00:00.000Z');
    const stats = await repo.customerSegments([D1], {
      activeSince: new Date('2026-10-31T17:00:00.000Z'), // last 30 days
      riskSince: new Date('2026-09-30T17:00:00.000Z'), // 31-60 days
      until,
    });
    expect(stats.active + stats.atRisk + stats.inactive).toBeGreaterThan(0);
    // repeater (5 Nov) and newHere (30 Nov, 23:30 WIB) are active; the 00:10 WIB 1 Dec order is not counted at all
    expect(stats.active).toBeGreaterThanOrEqual(2);
    const before = await repo.customerSegments([D1], { activeSince: until, riskSince: until, until });
    expect(before.active).toBe(0);
  });

  it('sums gallons of delivered or completed orders in the spans and splits counter sales by empties', async () => {
    const buyer = randomUUID();
    await order({ customerId: buyer, depotId: D2, at: '2026-11-12T03:00:00.000Z', gallons: 3 });
    await order({ customerId: buyer, depotId: D2, at: '2026-11-12T04:00:00.000Z', gallons: 2, status: 'CANCELLED' });
    await order({ customerId: buyer, depotId: D2, at: '2026-11-12T05:00:00.000Z', gallons: 4, status: 'CREATED' });
    await order({ customerId: buyer, depotId: D2, at: '2026-11-30T17:10:00.000Z', gallons: 9 }); // next month
    await expect(repo.gallonsSold([span(D2)])).resolves.toBe(3);
    const counter = (gallons: number, empties: number | null) =>
      order({ customerId: ANONYMOUS_CUSTOMER_ID, depotId: D2, at: '2026-11-13T03:00:00.000Z', walkIn: true, gallons, empties });
    await counter(2, 2); // refill
    await counter(2, 5); // refill (brought more)
    await counter(3, 1); // partial
    await counter(1, 0); // beli
    await counter(1, null); // not asked
    await expect(repo.refillSplit([span(D2)])).resolves.toEqual({ refill: 2, partial: 1, beli: 1, notAsked: 1 });
  });

  it('counts only orders still moving at the asked depots', async () => {
    const live = await repo.liveByStatus([D2]);
    expect(live).toEqual([{ status: 'CREATED', count: 1 }]);
  });
});
