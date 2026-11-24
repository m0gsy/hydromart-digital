import { randomUUID } from 'node:crypto';

import { DeliveryPrismaRepository } from '../../src/infrastructure/prisma/delivery.prisma.repository';
import { SettlementPrismaRepository } from '../../src/infrastructure/prisma/settlement.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H2, on a real Postgres: the period's undeposited COD (delivered COD no settlement lists, by
 * `orderIds @> ARRAY[orderId]`, whatever the settlement's depot) and the verified-deposit variances.
 */
const DEPOT = '11111111-1111-4111-8111-111111111111';
const OTHER_DEPOT = '22222222-2222-4222-8222-222222222222';
const from = new Date('2026-10-31T17:00:00.000Z');
const to = new Date('2026-11-30T17:00:00.000Z');

describeRace('HD-6 H2 COD period readers on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let deliveries: DeliveryPrismaRepository;
  let settlements: SettlementPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    deliveries = new DeliveryPrismaRepository(prisma as never);
    settlements = new SettlementPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const delivered = (o: Record<string, unknown>) =>
    prisma.delivery.create({
      data: {
        orderId: randomUUID(),
        orderNumber: `HM-${randomUUID().slice(0, 6)}`,
        driverId: randomUUID(),
        depotId: DEPOT,
        status: 'DELIVERED',
        destinationAddress: 'x',
        codAmount: 30_000,
        deliveredAt: new Date('2026-11-10T03:00:00.000Z'),
        ...o,
      } as never,
    });

  const settlement = (o: Record<string, unknown>) =>
    prisma.cashSettlement.create({
      data: {
        shiftId: randomUUID(),
        driverId: randomUUID(),
        depotId: DEPOT,
        orderIds: [],
        expectedAmount: 100_000,
        depositedAmount: 100_000,
        variance: 0,
        status: 'VERIFIED',
        verifiedAt: new Date('2026-11-10T03:00:00.000Z'),
        ...o,
      } as never,
    });

  it('counts delivered COD in the window that no settlement lists, whatever depot the settlement is in', async () => {
    const open = await delivered({});
    await delivered({ deliveredAt: new Date('2026-11-30T16:30:00.000Z'), codAmount: 5_000 }); // 23:30 WIB last day: in
    await delivered({ deliveredAt: new Date('2026-11-30T17:10:00.000Z') }); // 00:10 WIB next day: out
    await delivered({ codAmount: null }); // not COD
    await delivered({ depotId: OTHER_DEPOT });
    const listedHere = await delivered({});
    const listedElsewhere = await delivered({});
    await settlement({ orderIds: [listedHere.orderId] });
    // a settlement of ANOTHER depot (the courier's shift depot) lists this depot's order: still deposited
    await settlement({ depotId: OTHER_DEPOT, orderIds: [listedElsewhere.orderId] });
    const out = await deliveries.undepositedCodInWindow(DEPOT, from, to);
    expect(out).toEqual({ deliveries: 2, amountIdr: 35_000 });
    expect(open.orderId).toBeDefined();
  });

  it('keeps shortfalls and surpluses of verified settlements in the window apart', async () => {
    await settlement({ expectedAmount: 100_000, depositedAmount: 90_000, variance: -10_000 });
    await settlement({ expectedAmount: 100_000, depositedAmount: 105_000, variance: 5_000 });
    await settlement({ variance: -999, verifiedAt: new Date('2026-11-30T17:10:00.000Z') }); // out of the window
    await settlement({ variance: -888, status: 'SUBMITTED', verifiedAt: null }); // not verified
    await expect(settlements.varianceInWindow(DEPOT, from, to)).resolves.toEqual({ shortfallIdr: 10_000, surplusIdr: 5_000 });
  });
});
