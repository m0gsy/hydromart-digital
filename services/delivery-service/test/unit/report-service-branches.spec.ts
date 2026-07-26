import { randomUUID } from 'node:crypto';

import { ReportService } from '../../src/application/services/report.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import {
  FakeRating,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  buildTestConfig,
} from '../support/fakes';

const ASSIGNED = new Date('2026-06-10T00:00:00.000Z');

function seedDelivered(repo: InMemoryDeliveryRepository, depotId: string | null, offsetMin: number): void {
  repo.rows.push({
    id: randomUUID(),
    orderId: randomUUID(),
    orderNumber: 'HM-1',
    driverId: randomUUID(),
    depotId,
    status: DeliveryStatus.DELIVERED,
    destinationAddress: 'Jl. Merdeka 10',
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
    assignedAt: ASSIGNED,
    pickedUpAt: null,
    startedAt: null,
    deliveredAt: new Date(ASSIGNED.getTime() + offsetMin * 60_000),
    failedAt: null,
    failureReason: null,
    rescheduledFor: null,
    rescheduleSlot: null,
    rescheduleNote: null,
    proof: null,
    history: [],
    createdAt: ASSIGNED,
    updatedAt: ASSIGNED,
  });
}

describe('ReportService remaining branches', () => {
  let repo: InMemoryDeliveryRepository;
  let service: ReportService;

  beforeEach(() => {
    repo = new InMemoryDeliveryRepository();
    service = new ReportService(repo, new InMemorySettlementRepository(), new FakeRating(), buildTestConfig());
  });

  it('slaByDepot echoes an explicit from/to range (non-null branch)', async () => {
    seedDelivered(repo, randomUUID(), 60);
    const r = await service.slaByDepot({
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(r.from).toBe('2026-06-01T00:00:00.000Z');
    expect(r.to).toBe('2026-07-01T00:00:00.000Z');
    expect(r.depots).toHaveLength(1);
  });

  it('depotTeam handles a courier with only a failure (no rating, 0 on-time)', async () => {
    const depotId = randomUUID();
    const driverId = randomUUID();
    repo.rows.push({
      id: randomUUID(),
      orderId: randomUUID(),
      orderNumber: 'HM-2',
      driverId,
      depotId,
      status: DeliveryStatus.FAILED,
      destinationAddress: 'Jl. Merdeka 10',
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
      assignedAt: ASSIGNED,
      pickedUpAt: null,
      startedAt: null,
      deliveredAt: null,
      failedAt: new Date(ASSIGNED.getTime() + 30 * 60_000),
      failureReason: 'not found',
      rescheduledFor: null,
      rescheduleSlot: null,
      rescheduleNote: null,
      proof: null,
      history: [],
      createdAt: ASSIGNED,
      updatedAt: ASSIGNED,
    });

    const r = await service.depotTeam(
      depotId,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );
    expect(r.couriers).toEqual([{ driverId, delivered: 0, onTimeRate: 0, failed: 1, rating: null }]);
  });
});
