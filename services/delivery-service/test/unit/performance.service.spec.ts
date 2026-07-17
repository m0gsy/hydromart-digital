import { randomUUID } from 'node:crypto';

import { PerformanceService } from '../../src/application/services/performance.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { DeliveryRecord } from '../../src/application/ports/delivery.repository';
import { buildTestConfig, FakeRating, InMemoryDeliveryRepository } from '../support/fakes';

const DEPOT = '00000000-0000-4000-8000-000000000001';

/** Push a delivery straight into the repo with the fields the roll-up reads. */
function seed(
  repo: InMemoryDeliveryRepository,
  p: Partial<DeliveryRecord> & { driverId: string },
): string {
  const orderId = p.orderId ?? randomUUID();
  repo.rows.push({
    id: randomUUID(),
    orderId,
    orderNumber: 'HM-1',
    depotId: DEPOT,
    status: DeliveryStatus.DELIVERED,
    destinationAddress: 'x',
    destinationLat: null,
    destinationLng: null,
    lastLat: null,
    lastLng: null,
    lastLocationAt: null,
    assignedAt: new Date('2026-07-13T00:00:00Z'),
    pickedUpAt: null,
    startedAt: null,
    deliveredAt: null,
    failedAt: null,
    failureReason: null,
    rescheduledFor: null,
    rescheduleSlot: null,
    rescheduleNote: null,
    proof: null,
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...p,
  });
  return orderId;
}

describe('PerformanceService.weekly', () => {
  let repo: InMemoryDeliveryRepository;
  let rating: FakeRating;
  let service: PerformanceService;
  const driver = randomUUID();

  beforeEach(() => {
    repo = new InMemoryDeliveryRepository();
    rating = new FakeRating();
    service = new PerformanceService(repo, rating, buildTestConfig());
  });

  it('rolls up count, per-day bars, on-time rate, rating and target (design 4c)', async () => {
    // Two on-time (Mon 13, Wed 15) + one breached (assigned far earlier, delivered Fri 17).
    const o1 = seed(repo, {
      driverId: driver,
      deliveredAt: new Date('2026-07-13T05:00:00Z'), // Mon 12:00 WIB
      assignedAt: new Date('2026-07-13T04:30:00Z'), // 30 min → on-time
    });
    const o2 = seed(repo, {
      driverId: driver,
      deliveredAt: new Date('2026-07-15T05:00:00Z'), // Wed
      assignedAt: new Date('2026-07-15T04:30:00Z'),
    });
    seed(repo, {
      driverId: driver,
      deliveredAt: new Date('2026-07-17T05:00:00Z'), // Fri
      assignedAt: new Date('2026-07-17T00:00:00Z'), // 5h → breached (SLA 120 min)
    });
    seed(repo, {
      driverId: driver,
      status: DeliveryStatus.FAILED,
      failedAt: new Date('2026-07-16T05:00:00Z'),
    });
    rating.ratings.set(o1, 5);
    rating.ratings.set(o2, 4);

    const r = await service.weekly(driver, '2026-07-13', DEPOT);

    expect(r.delivered).toBe(3);
    expect(r.perDay).toEqual([1, 0, 1, 0, 1, 0, 0]); // Mon, Wed, Fri
    expect(r.onTime).toBe(2);
    expect(r.onTimeRate).toBeCloseTo(2 / 3);
    expect(r.failed).toBe(1);
    expect(r.rating).toBe(4.5);
    expect(r.target).toBe(45);
    expect(r.targetMet).toBe(false);
  });

  it('ranks the courier against depot peers, denominator = couriers with a delivery', async () => {
    const rival = randomUUID();
    // Rival delivers 3 this week, our driver 1 → rank #2 of 2.
    for (let i = 0; i < 3; i++) {
      seed(repo, { driverId: rival, deliveredAt: new Date('2026-07-14T05:00:00Z') });
    }
    seed(repo, { driverId: driver, deliveredAt: new Date('2026-07-14T05:00:00Z') });

    const r = await service.weekly(driver, '2026-07-13', DEPOT);
    expect(r.rank).toBe(2);
    expect(r.depotCouriers).toBe(2);
  });

  it('computes the prior-week rank for the week-over-week delta (design 4c)', async () => {
    const rival = randomUUID();
    // Prev week (Mon 6 Jul): driver 2, rival 1 → prev rank #1. This week: rival 3, driver 1 → #2.
    seed(repo, { driverId: driver, deliveredAt: new Date('2026-07-06T05:00:00Z') });
    seed(repo, { driverId: driver, deliveredAt: new Date('2026-07-07T05:00:00Z') });
    seed(repo, { driverId: rival, deliveredAt: new Date('2026-07-06T05:00:00Z') });
    for (let i = 0; i < 3; i++) {
      seed(repo, { driverId: rival, deliveredAt: new Date('2026-07-14T05:00:00Z') });
    }
    seed(repo, { driverId: driver, deliveredAt: new Date('2026-07-14T05:00:00Z') });

    const r = await service.weekly(driver, '2026-07-13', DEPOT);
    expect(r.rank).toBe(2);
    expect(r.rankPrev).toBe(1);
  });

  it('omits rank when no depot is given, and reports null rating with no reviews', async () => {
    seed(repo, { driverId: driver, deliveredAt: new Date('2026-07-14T05:00:00Z') });
    const r = await service.weekly(driver, '2026-07-13');
    expect(r.rank).toBeNull();
    expect(r.rankPrev).toBeNull();
    expect(r.rating).toBeNull();
  });
});
