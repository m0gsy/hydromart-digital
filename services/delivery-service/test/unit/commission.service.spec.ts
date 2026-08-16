import { randomUUID } from 'node:crypto';

import { CommissionService } from '../../src/application/services/commission.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { SettlementStatus } from '../../src/domain/settlement';
import {
  FakeCourierPayout,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
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
    notes: null,
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
  let payout: FakeCourierPayout;
  let service: CommissionService;
  const depot = randomUUID();
  const driverA = randomUUID();
  const driverB = randomUUID();

  beforeEach(() => {
    deliveries = new InMemoryDeliveryRepository();
    settlements = new InMemorySettlementRepository();
    payout = new FakeCourierPayout();
    service = new CommissionService(deliveries, settlements, payout);
  });

  /*
   * E-1. This report used to answer `delivered × courierRatePerDeliveryIdr` — a flat rate
   * configured in THIS service, which pays nobody. payout-service pays
   * `baseFare + peakBonus + onTimeBonus` plus a monthly incentive ladder, so a manager's
   * commission run and the courier's own ledger stated two different amounts for the same
   * deliveries, and both were live. The report reads the payer now.
   */
  it('reports what the payer credited, not a rate of its own', async () => {
    seedDelivered(deliveries, depot, driverA, inWindow);
    seedDelivered(deliveries, depot, driverA, inWindow);
    seedDelivered(deliveries, depot, driverB, inWindow);
    // driverA has an accepted COD shortfall of 5000 (variance negative, charged).
    seedSettlement(settlements, depot, driverA, -5000, true, inWindow);
    // What payout actually posted: driverA's two fares came to 27.500 (a peak run and an
    // on-time bonus), not 2 × 12.000. That difference IS the bug.
    payout.earnings.set(depot, [
      { courierId: driverA, earnedIdr: 27500, paidDeliveries: 2 },
      { courierId: driverB, earnedIdr: 12000, paidDeliveries: 1 },
    ]);

    const run = await service.run(depot, FROM, TO);

    expect(run.source).toBe('payout');
    const a = run.couriers.find((c) => c.courierId === driverA)!;
    const b = run.couriers.find((c) => c.courierId === driverB)!;
    expect(a).toMatchObject({
      delivered: 2,
      paidDeliveries: 2,
      grossIdr: 27500,
      shortfallIdr: 5000,
      netIdr: 22500,
    });
    expect(b).toMatchObject({ delivered: 1, grossIdr: 12000, shortfallIdr: 0, netIdr: 12000 });
    expect(run.totalIdr).toBe(34500);
    // Highest net first.
    expect(run.couriers[0].courierId).toBe(driverA);
  });

  it('ignores un-charged / disputed shortfalls and out-of-window deliveries', async () => {
    seedDelivered(deliveries, depot, driverA, inWindow);
    seedDelivered(deliveries, depot, driverA, new Date('2026-07-15T00:00:00.000Z')); // out of window
    // A shortfall that the cashier did NOT charge must not be deducted.
    seedSettlement(settlements, depot, driverA, -8000, false, inWindow);
    payout.earnings.set(depot, [{ courierId: driverA, earnedIdr: 12000, paidDeliveries: 1 }]);

    const run = await service.run(depot, FROM, TO);

    const a = run.couriers.find((c) => c.courierId === driverA)!;
    expect(a).toMatchObject({ delivered: 1, grossIdr: 12000, shortfallIdr: 0, netIdr: 12000 });
  });

  /*
   * The whole point of the change: when the payer cannot be read the report says so. A
   * locally computed fallback is exactly how the second number was born, so there is none.
   */
  it('reports the run as unavailable rather than pricing it itself', async () => {
    seedDelivered(deliveries, depot, driverA, inWindow);
    payout.earnings.set(depot, null);

    const run = await service.run(depot, FROM, TO);

    expect(run.source).toBe('unavailable');
    expect(run.couriers).toEqual([]);
    expect(run.totalIdr).toBeNull();
  });

  /*
   * The earning push fails open by design (a delivery must never fail because payout was
   * down), so a delivery can exist here with no earning there. That gap used to be
   * invisible — the report multiplied its own count by its own rate and always balanced.
   */
  it('shows a delivery the payer never paid for instead of pricing it anyway', async () => {
    seedDelivered(deliveries, depot, driverA, inWindow);
    seedDelivered(deliveries, depot, driverA, inWindow);
    payout.earnings.set(depot, [{ courierId: driverA, earnedIdr: 12000, paidDeliveries: 1 }]);

    const run = await service.run(depot, FROM, TO);

    expect(run.couriers[0]).toMatchObject({ delivered: 2, paidDeliveries: 1, grossIdr: 12000 });
  });

  // The mirror: paid at this depot with nothing delivered here. Dropping either side of the
  // union would hide the disagreement the report exists to surface.
  it('lists a courier the payer paid but this depot recorded no delivery for', async () => {
    payout.earnings.set(depot, [{ courierId: driverB, earnedIdr: 9000, paidDeliveries: 1 }]);

    const run = await service.run(depot, FROM, TO);

    expect(run.couriers).toHaveLength(1);
    expect(run.couriers[0]).toMatchObject({ courierId: driverB, delivered: 0, grossIdr: 9000 });
  });

  it('returns an empty run for a depot with no delivered orders', async () => {
    const run = await service.run(depot, FROM, TO);
    expect(run.couriers).toEqual([]);
    expect(run.totalIdr).toBe(0);
  });
});
