import { randomUUID } from 'node:crypto';

import { NO_SHOW_REASON } from '../../src/domain/no-show';
import { AiDeliveryPrismaRepository } from '../../src/infrastructure/prisma/ai-delivery.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H3 on a real Postgres: delivered / on-time / median / failed / rescheduled over spans.
 * The columns are naive UTC timestamps and the spans are instants, so the edges are checked:
 * 23:30 WIB on the last day is in, 00:10 WIB the next day is out, and a depot that changes hands
 * mid-period counts only for the days of its span.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const FROM = new Date('2026-10-31T17:00:00.000Z');
const TO = new Date('2026-11-30T17:00:00.000Z');
const span = (depotId: string, from = FROM, to = TO) => ({ depotId, from, to });
const g = (depotId: string, from = FROM, to = TO, thresholdMinutes = 90) => ({ depotId, from, to, thresholdMinutes });

describeRace('HD-6 H3 delivery summary on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AiDeliveryPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AiDeliveryPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const row = (over: Record<string, unknown>) =>
    prisma.delivery.create({
      data: {
        orderId: randomUUID(),
        orderNumber: `HM-${randomUUID()}`,
        driverId: randomUUID(),
        depotId: D1,
        destinationAddress: 'x',
        ...over,
      } as never,
    });
  const at = (iso: string, plusMin = 0) => new Date(new Date(iso).getTime() + plusMin * 60_000);

  it('counts delivered, the stored verdict first, the median on the restarted clock, distinct couriers', async () => {
    const courier = randomUUID();
    // 50 min, stored on time
    await row({ status: 'DELIVERED', driverId: courier, assignedAt: at('2026-11-05T01:00:00.000Z'), deliveredAt: at('2026-11-05T01:00:00.000Z', 50), slaOnTime: true });
    // 50 min but the stored verdict says late: the stored verdict is never re-graded
    await row({ status: 'DELIVERED', driverId: courier, assignedAt: at('2026-11-05T02:00:00.000Z'), deliveredAt: at('2026-11-05T02:00:00.000Z', 50), slaOnTime: false });
    // an old row, no verdict: 200 min since assignment but only 20 on the restarted clock; threshold 90 -> on time
    await row({
      status: 'DELIVERED',
      assignedAt: at('2026-11-05T03:00:00.000Z'),
      slaStartedAt: at('2026-11-05T03:00:00.000Z', 180),
      deliveredAt: at('2026-11-05T03:00:00.000Z', 200),
    });
    // last WIB minute of the window: in. First minute after: out. Other depot: out.
    await row({ status: 'DELIVERED', assignedAt: at('2026-11-30T16:00:00.000Z'), deliveredAt: at('2026-11-30T16:30:00.000Z'), slaOnTime: true });
    await row({ status: 'DELIVERED', assignedAt: at('2026-11-30T16:00:00.000Z'), deliveredAt: at('2026-11-30T17:10:00.000Z'), slaOnTime: true });
    await row({ status: 'DELIVERED', depotId: D2, assignedAt: at('2026-11-05T01:00:00.000Z'), deliveredAt: at('2026-11-05T01:00:00.000Z', 10), slaOnTime: true });
    const s = await repo.deliveredStats([g(D1)]);
    expect(s.delivered).toBe(4);
    expect(s.onTime).toBe(3); // stored true, stored false, graded on time, stored true
    expect(s.storedVerdicts).toBe(3);
    expect(s.couriers).toBe(3); // courier twice, plus two others (nobody here only failed)
    expect(s.medianMinutes).toBe(40); // 50, 50, 20 (restarted clock), 30
  });

  it('reads nothing outside the span of a depot that changed hands mid-period', async () => {
    const mid = new Date('2026-11-15T17:00:00.000Z');
    const first = await repo.deliveredStats([g(D1, FROM, mid)]);
    const second = await repo.deliveredStats([g(D1, mid, TO)]);
    const whole = await repo.deliveredStats([g(D1)]);
    expect(first.delivered + second.delivered).toBe(whole.delivered);
    const empty = await repo.deliveredStats([g(randomUUID())]);
    expect(empty).toEqual({ delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null, couriers: 0 });
  });

  it('counts failures by failure time with the no-show apart, and reschedules by when they happened', async () => {
    await row({ status: 'FAILED', failedAt: at('2026-11-06T03:00:00.000Z'), failureReason: NO_SHOW_REASON });
    await row({ status: 'FAILED', failedAt: at('2026-11-06T04:00:00.000Z'), failureReason: 'Alamat tidak ketemu, telp 0812-3456-7890' });
    await row({ status: 'FAILED', failedAt: at('2026-11-30T17:10:00.000Z'), failureReason: NO_SHOW_REASON }); // out
    await row({ status: 'FAILED', depotId: D2, failedAt: at('2026-11-06T03:00:00.000Z'), failureReason: NO_SHOW_REASON }); // other depot
    const resched = await row({ status: 'RESCHEDULED', rescheduledFor: at('2026-11-20T03:00:00.000Z') });
    await prisma.deliveryStatusHistory.create({ data: { deliveryId: resched.id, status: 'RESCHEDULED', createdAt: at('2026-11-07T03:00:00.000Z') } as never });
    await prisma.deliveryStatusHistory.create({ data: { deliveryId: resched.id, status: 'ASSIGNED', createdAt: at('2026-11-07T04:00:00.000Z') } as never });
    await prisma.deliveryStatusHistory.create({ data: { deliveryId: resched.id, status: 'RESCHEDULED', createdAt: at('2026-12-02T04:00:00.000Z') } as never });
    await expect(repo.failedStats([span(D1)])).resolves.toEqual({ failed: 2, noShow: 1, rescheduled: 1 });
  });

  it('counts a courier who only failed, once, with the ones who delivered, and grades old rows with the span threshold', async () => {
    const depot = randomUUID();
    const failer = randomUUID();
    const both = randomUUID();
    await row({ depotId: depot, status: 'FAILED', driverId: failer, failedAt: at('2026-11-06T03:00:00.000Z'), failureReason: 'x' });
    await row({ depotId: depot, status: 'FAILED', driverId: both, failedAt: at('2026-11-06T04:00:00.000Z'), failureReason: 'x' });
    // 70 min with no stored verdict: late at 60, on time at 90
    await row({ depotId: depot, status: 'DELIVERED', driverId: both, assignedAt: at('2026-11-05T01:00:00.000Z'), deliveredAt: at('2026-11-05T01:00:00.000Z', 70) });
    await row({ depotId: depot, status: 'FAILED', driverId: failer, failedAt: at('2026-11-30T17:10:00.000Z'), failureReason: 'x' }); // out
    const strict = await repo.deliveredStats([g(depot, FROM, TO, 60)]);
    const lax = await repo.deliveredStats([g(depot, FROM, TO, 90)]);
    expect(strict).toMatchObject({ delivered: 1, onTime: 0, couriers: 2 });
    expect(lax).toMatchObject({ onTime: 1, couriers: 2 });
  });
});
