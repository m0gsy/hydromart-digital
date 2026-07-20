import { randomUUID } from 'node:crypto';

import { ReportService } from '../../src/application/services/report.service';
import { DeliveryRecord } from '../../src/application/ports/delivery.repository';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { InMemoryDeliveryRepository, buildTestConfig } from '../support/fakes';

const ASSIGNED = new Date('2026-06-01T00:00:00.000Z');
const at = (min: number): Date => new Date(ASSIGNED.getTime() + min * 60_000);

function seed(repo: InMemoryDeliveryRepository, over: Partial<DeliveryRecord>): void {
  repo.rows.push({
    id: randomUUID(),
    orderId: randomUUID(),
    orderNumber: 'HM-1',
    driverId: randomUUID(),
    depotId: null,
    status: DeliveryStatus.DELIVERED,
    destinationAddress: 'Jl. Merdeka 10',
    destinationLat: null,
    destinationLng: null,
    recipientPhone: null,
    items: null,
    codAmount: null,
    lastLat: null,
    lastLng: null,
    lastLocationAt: null,
    assignedAt: ASSIGNED,
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
    createdAt: ASSIGNED,
    updatedAt: ASSIGNED,
    ...over,
  });
}

describe('ReportService.sla', () => {
  let repo: InMemoryDeliveryRepository;
  let service: ReportService;

  beforeEach(() => {
    repo = new InMemoryDeliveryRepository();
    service = new ReportService(repo, buildTestConfig()); // DELIVERY_SLA_MINUTES=120
  });

  it('counts on-time (incl. boundary) vs breached, averages minutes, and counts failures', async () => {
    seed(repo, { deliveredAt: at(60) }); // on time
    seed(repo, { deliveredAt: at(120) }); // on time (== threshold)
    seed(repo, { deliveredAt: at(181) }); // breached
    seed(repo, { status: DeliveryStatus.FAILED, failedAt: at(300) });
    seed(repo, { status: DeliveryStatus.FAILED, failedAt: at(360) });

    const r = await service.sla({});

    expect(r.thresholdMinutes).toBe(120);
    expect(r.totalDelivered).toBe(3);
    expect(r.onTime).toBe(2);
    expect(r.breached).toBe(1);
    expect(r.slaRate).toBeCloseTo(2 / 3, 5);
    expect(r.avgMinutes).toBe(120.3); // (60+120+181)/3 = 120.333 -> 120.3
    expect(r.failedCount).toBe(2);
  });

  it('filters delivered/failed by the range on their own timestamps', async () => {
    seed(repo, { deliveredAt: at(60) }); // 2026-06-01, in range
    seed(repo, { deliveredAt: new Date('2026-07-01T00:00:00.000Z') }); // out of range
    seed(repo, { status: DeliveryStatus.FAILED, failedAt: at(120) }); // in range

    const r = await service.sla({
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-02T00:00:00.000Z'),
    });

    expect(r.from).toBe('2026-06-01T00:00:00.000Z');
    expect(r.to).toBe('2026-06-02T00:00:00.000Z');
    expect(r.totalDelivered).toBe(1);
    expect(r.failedCount).toBe(1);
  });

  it('honours an explicit thresholdMinutes over the configured default', async () => {
    seed(repo, { deliveredAt: at(90) });

    const r = await service.sla({}, 60);

    expect(r.thresholdMinutes).toBe(60);
    expect(r.onTime).toBe(0);
    expect(r.breached).toBe(1);
  });

  it('scopes to depotIds when given, excluding other and null-depot deliveries', async () => {
    const depotA = randomUUID();
    const depotB = randomUUID();
    seed(repo, { depotId: depotA, deliveredAt: at(60) }); // in scope, on time
    seed(repo, { depotId: depotA, deliveredAt: at(181) }); // in scope, breached
    seed(repo, { depotId: depotB, deliveredAt: at(60) }); // other depot
    seed(repo, { depotId: null, deliveredAt: at(60) }); // legacy, unattributed
    seed(repo, { depotId: depotA, status: DeliveryStatus.FAILED, failedAt: at(300) });
    seed(repo, { depotId: depotB, status: DeliveryStatus.FAILED, failedAt: at(300) });

    const r = await service.sla({}, undefined, [depotA]);

    expect(r.totalDelivered).toBe(2);
    expect(r.onTime).toBe(1);
    expect(r.breached).toBe(1);
    expect(r.failedCount).toBe(1);
  });

  it('returns slaRate 0 and avgMinutes null for an empty set', async () => {
    const r = await service.sla({});

    expect(r.totalDelivered).toBe(0);
    expect(r.slaRate).toBe(0);
    expect(r.avgMinutes).toBeNull();
    expect(r.failedCount).toBe(0);
  });

  it('groups SLA per depot, excluding null-depot deliveries', async () => {
    const depotA = randomUUID();
    const depotB = randomUUID();
    seed(repo, { depotId: depotA, deliveredAt: at(60) }); // A on time
    seed(repo, { depotId: depotA, deliveredAt: at(181) }); // A breached
    seed(repo, { depotId: depotB, deliveredAt: at(60) }); // B on time
    seed(repo, { depotId: null, deliveredAt: at(60) }); // unattributed → excluded

    const r = await service.slaByDepot({});

    expect(r.thresholdMinutes).toBe(120);
    expect(r.depots).toHaveLength(2);
    const a = r.depots.find((d) => d.depotId === depotA)!;
    expect(a).toMatchObject({ totalDelivered: 2, onTime: 1, breached: 1 });
    expect(a.slaRate).toBeCloseTo(0.5, 5);
    expect(a.avgMinutes).toBe(120.5); // (60+181)/2
    const b = r.depots.find((d) => d.depotId === depotB)!;
    expect(b).toMatchObject({ totalDelivered: 1, onTime: 1, breached: 0, slaRate: 1 });
  });
});
