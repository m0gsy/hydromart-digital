import { randomUUID } from 'node:crypto';

import { CommissionService } from '../../src/application/services/commission.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { SettlementStatus } from '../../src/domain/settlement';
import {
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  buildTestConfig,
} from '../support/fakes';

const FROM = new Date('2026-06-01T00:00:00.000Z');
const TO = new Date('2026-07-01T00:00:00.000Z');
const inWindow = new Date('2026-06-15T00:00:00.000Z');

function seedDelivered(
  repo: InMemoryDeliveryRepository,
  depotId: string,
  driverId: string,
  deliveredAt: Date,
): void {
  repo.rows.push({
    id: randomUUID(),
    orderId: randomUUID(),
    orderNumber: 'HM-1',
    driverId,
    depotId,
    status: DeliveryStatus.DELIVERED,
    destinationAddress: 'x',
    destinationLat: null,
    destinationLng: null,
    recipientPhone: null,
    items: null,
    codAmount: null,
    estimatedArrivalAt: null,
    lastLat: null,
    lastLng: null,
    lastLocationAt: null,
    assignedAt: deliveredAt,
    pickedUpAt: null,
    startedAt: null,
    deliveredAt,
    failedAt: null,
    failureReason: null,
    rescheduledFor: null,
    rescheduleSlot: null,
    rescheduleNote: null,
    proof: null,
    history: [],
    createdAt: deliveredAt,
    updatedAt: deliveredAt,
  });
}

function seedSettlement(
  repo: InMemorySettlementRepository,
  depotId: string,
  driverId: string,
  variance: number,
  chargedToDriver: boolean,
  createdAt: Date,
): void {
  repo.rows.push({
    id: randomUUID(),
    shiftId: randomUUID(),
    driverId,
    depotId,
    status: SettlementStatus.VERIFIED,
    orderIds: [],
    expectedAmount: 0,
    depositedAmount: 0,
    variance,
    chargedToDriver,
    note: null,
    verifiedBy: randomUUID(),
    verifiedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
}

describe('CommissionService', () => {
  let deliveries: InMemoryDeliveryRepository;
  let settlements: InMemorySettlementRepository;
  let service: CommissionService;
  const depot = randomUUID();
  const driverA = randomUUID();
  const driverB = randomUUID();

  beforeEach(() => {
    deliveries = new InMemoryDeliveryRepository();
    settlements = new InMemorySettlementRepository();
    // COURIER_RATE_PER_DELIVERY_IDR defaults to 12000.
    service = new CommissionService(deliveries, settlements, buildTestConfig());
  });

  it('computes gross = delivered × rate, minus charged shortfall, and a period total', async () => {
    seedDelivered(deliveries, depot, driverA, inWindow);
    seedDelivered(deliveries, depot, driverA, inWindow);
    seedDelivered(deliveries, depot, driverB, inWindow);
    // driverA has an accepted COD shortfall of 5000 (variance negative, charged).
    seedSettlement(settlements, depot, driverA, -5000, true, inWindow);

    const run = await service.run(depot, FROM, TO);

    expect(run.ratePerDeliveryIdr).toBe(12000);
    const a = run.couriers.find((c) => c.courierId === driverA)!;
    const b = run.couriers.find((c) => c.courierId === driverB)!;
    expect(a).toMatchObject({ delivered: 2, grossIdr: 24000, shortfallIdr: 5000, netIdr: 19000 });
    expect(b).toMatchObject({ delivered: 1, grossIdr: 12000, shortfallIdr: 0, netIdr: 12000 });
    expect(run.totalIdr).toBe(31000); // 19000 + 12000
    // Highest net first.
    expect(run.couriers[0].courierId).toBe(driverA);
  });

  it('ignores un-charged / disputed shortfalls and out-of-window deliveries', async () => {
    seedDelivered(deliveries, depot, driverA, inWindow);
    seedDelivered(deliveries, depot, driverA, new Date('2026-07-15T00:00:00.000Z')); // out of window
    // A shortfall that the cashier did NOT charge must not be deducted.
    seedSettlement(settlements, depot, driverA, -8000, false, inWindow);

    const run = await service.run(depot, FROM, TO);

    const a = run.couriers.find((c) => c.courierId === driverA)!;
    expect(a).toMatchObject({ delivered: 1, grossIdr: 12000, shortfallIdr: 0, netIdr: 12000 });
  });

  it('honours a configured rate override', async () => {
    seedDelivered(deliveries, depot, driverA, inWindow);
    const svc = new CommissionService(
      deliveries,
      settlements,
      buildTestConfig({ COURIER_RATE_PER_DELIVERY_IDR: '15000' }),
    );

    const run = await svc.run(depot, FROM, TO);

    expect(run.ratePerDeliveryIdr).toBe(15000);
    expect(run.couriers[0].grossIdr).toBe(15000);
  });

  it('returns an empty run for a depot with no delivered orders', async () => {
    const run = await service.run(depot, FROM, TO);
    expect(run.couriers).toEqual([]);
    expect(run.totalIdr).toBe(0);
  });
});
