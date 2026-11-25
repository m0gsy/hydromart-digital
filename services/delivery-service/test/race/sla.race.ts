import { randomUUID } from 'node:crypto';

import { DeliveryStatus } from '../../src/domain/delivery-status';
import { DeliveryPrismaRepository } from '../../src/infrastructure/prisma/delivery.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6: the three raw SQL statements that grade and alert on the stored on-time status, run
 * against real Postgres (the unit specs only see a mocked $queryRaw).
 */
describeRace('stored on-time status on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: DeliveryPrismaRepository;
  const depot = randomUUID();
  const T0 = new Date('2026-11-01T01:00:00.000Z');
  const at = (m: number): Date => new Date(T0.getTime() + m * 60_000);

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new DeliveryPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const row = (over: Record<string, unknown>) =>
    prisma.delivery.create({
      data: {
        orderId: randomUUID(),
        orderNumber: `HM-${randomUUID()}`,
        driverId: randomUUID(),
        depotId: depot,
        destinationAddress: 'Jl. Merdeka 10',
        ...over,
      } as never,
    });

  it('slaStats and slaStatsByDepot: the stored verdict wins, minutes follow the same clock', async () => {
    // 100 min on the first clock; 30 on a restarted one; the stored flags disagree with 60.
    await row({ status: 'DELIVERED', assignedAt: at(0), deliveredAt: at(100), slaOnTime: false });
    await row({
      status: 'DELIVERED',
      assignedAt: at(0),
      slaStartedAt: at(70),
      deliveredAt: at(100),
      slaOnTime: true,
    });
    await row({ status: 'DELIVERED', assignedAt: at(0), deliveredAt: at(50) }); // old row, 50 <= 60
    await row({ status: 'DELIVERED', assignedAt: at(0), deliveredAt: at(80) }); // old row, 80 > 60

    const stats = await repo.slaStats({}, 60, [depot]);
    expect(stats).toMatchObject({ totalDelivered: 4, onTime: 2, storedVerdicts: 2 });
    // minutes: 100 + 30 + 50 + 80
    expect(stats.sumMinutes).toBeCloseTo(260);

    const [byDepot] = await repo.slaStatsByDepot({}, 60);
    expect(byDepot).toMatchObject({
      depotId: depot,
      totalDelivered: 4,
      onTime: 2,
      storedVerdicts: 2,
    });
    expect(byDepot.sumMinutes).toBeCloseTo(260);
  });

  it('findUnalertedInFlight uses the restarted clock for the cutoff and the order', async () => {
    const d2 = randomUUID();
    const mk = (n: string, over: Record<string, unknown>) =>
      prisma.delivery.create({
        data: {
          orderId: randomUUID(),
          orderNumber: n,
          driverId: randomUUID(),
          depotId: d2,
          destinationAddress: 'x',
          status: DeliveryStatus.ON_DELIVERY,
          ...over,
        } as never,
      });
    await mk('OLD', { assignedAt: at(0) });
    await mk('RESTARTED', { assignedAt: at(-3 * 24 * 60), slaStartedAt: at(500) });
    await mk('ALERTED', { assignedAt: at(0), slaAlertedAt: at(10) });
    await mk('DONE', { assignedAt: at(0), status: DeliveryStatus.DELIVERED });

    const found = await repo.findUnalertedInFlight(at(400), 50);
    const mine = found.filter((r) => r.depotId === d2);
    expect(mine.map((r) => r.orderNumber)).toEqual(['OLD']); // RESTARTED began after the cutoff
    expect(mine[0].clockStartedAt.getTime()).toBe(at(0).getTime());

    const later = (await repo.findUnalertedInFlight(at(600), 50)).filter((r) => r.depotId === d2);
    expect(later.map((r) => r.orderNumber)).toEqual(['OLD', 'RESTARTED']); // oldest clock first
  });

  it('re-opening: CUSTOMER restarts the clock and clears the alert, DEPOT keeps both clocks', async () => {
    const mkResched = (initiator: string | null) =>
      row({
        status: DeliveryStatus.RESCHEDULED,
        assignedAt: at(0),
        slaAlertedAt: at(5),
        rescheduleInitiator: initiator,
      });
    const customer = await mkResched('CUSTOMER');
    const depotRow = await mkResched('DEPOT');
    const courierRow = await mkResched('COURIER');

    const a = await repo.reassignIfUnderCap(customer.id, randomUUID(), randomUUID(), null, 5);
    const b = await repo.reassignIfUnderCap(depotRow.id, randomUUID(), randomUUID(), null, 5);

    expect(a.slaStartedAt).toBeInstanceOf(Date);
    expect(b.slaStartedAt).toBeNull();
    // A courier-side reschedule (courier could not make it) keeps the old clock like DEPOT does.
    const c = await repo.reassignIfUnderCap(courierRow.id, randomUUID(), randomUUID(), null, 5);
    expect(c.slaStartedAt).toBeNull();
    const raw = await prisma.delivery.findMany({
      where: { id: { in: [customer.id, depotRow.id, courierRow.id] } },
    });
    expect(raw.every((r) => r.slaAlertedAt === null)).toBe(true);
  });
});
