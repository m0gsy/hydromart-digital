import { randomUUID } from 'node:crypto';

import { SlaAlertService } from '../../src/application/services/sla-alert.service';
import { SETTING_DEFS } from '../../src/config/setting-defs';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { buildTestConfig, FakeOpsNotifier, InMemoryDeliveryRepository } from '../support/fakes';

/**
 * J8. The SLA existed only as a percentage in a report: nothing looked at a delivery
 * while it was still late and still rescuable. Every case here is about that window.
 */
describe('SlaAlertService', () => {
  const NOW = new Date('2026-08-25T10:00:00.000Z');
  const depot = randomUUID();

  let repo: InMemoryDeliveryRepository;
  let ops: FakeOpsNotifier;
  let service: SlaAlertService;

  beforeEach(() => {
    repo = new InMemoryDeliveryRepository();
    ops = new FakeOpsNotifier();
    // 120-minute SLA, the shipped default.
    service = new SlaAlertService(repo, ops, buildTestConfig());
  });

  /** Puts one delivery on the road, assigned `minutesAgo` before NOW. */
  const onTheRoad = async (minutesAgo: number, status = DeliveryStatus.ON_DELIVERY): Promise<string> => {
    const row = await repo.create({
      orderId: randomUUID(),
      orderNumber: `HM-${minutesAgo}`,
      driverId: randomUUID(),
      depotId: depot,
      destinationAddress: 'Jl. Merdeka 1',
      destinationLat: null,
      destinationLng: null,
      recipientPhone: null,
      items: null,
      codAmount: null,
      notes: null,
      deliveryWindow: null,
    });
    // `create` hands back a CLONE, so the row the sweep reads is the one in `repo.rows`.
    const stored = repo.rows.find((r) => r.id === row.id)!;
    stored.status = status;
    stored.assignedAt = new Date(NOW.getTime() - minutesAgo * 60_000);
    return stored.id;
  };

  it('calls someone when a delivery is past its depot SLA', async () => {
    await onTheRoad(200);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ ok: true, breached: 1, alerted: 1 });
    expect(ops.slaAlerts).toHaveLength(1);
    expect(ops.slaAlerts[0]).toMatchObject({
      orderNumber: 'HM-200',
      minutes: 200,
      thresholdMinutes: 120,
      depotId: depot,
    });
  });

  it('stays silent for a delivery still inside the window', async () => {
    await onTheRoad(90);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ ok: true, breached: 0, alerted: 0 });
    expect(ops.slaAlerts).toHaveLength(0);
  });

  it('does not alert the same delivery twice', async () => {
    await onTheRoad(200);

    await service.sweep(NOW);
    const second = await service.sweep(new Date(NOW.getTime() + 60 * 60_000));

    expect(second).toMatchObject({ checked: 0, breached: 0, alerted: 0 });
    expect(ops.slaAlerts).toHaveLength(1);
  });

  it('leaves the delivery unstamped when the alert did not reach ops, and retries next tick', async () => {
    await onTheRoad(200);
    ops.slaAlertFails = true;

    const first = await service.sweep(NOW);
    // J7: five tried, none delivered, and the sweep says so instead of answering "fine".
    expect(first).toMatchObject({ ok: false, breached: 1, alerted: 0 });

    ops.slaAlertFails = false;
    const second = await service.sweep(NOW);
    expect(second).toMatchObject({ ok: true, breached: 1, alerted: 1 });
    expect(ops.slaAlerts).toHaveLength(1);
  });

  it('ignores deliveries that already finished', async () => {
    await onTheRoad(300, DeliveryStatus.DELIVERED);
    await onTheRoad(300, DeliveryStatus.FAILED);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ checked: 0, breached: 0, alerted: 0 });
  });

  it('keeps its coarse cutoff at the tightest SLA a depot may configure', () => {
    // If somebody lowers the setting's floor, the sweep's pre-filter starts skipping
    // deliveries that CAN breach earlier than it looks for — silently, and only at the
    // depots that took the tighter setting. This is the check that says so.
    const floor = SETTING_DEFS.find((d) => d.key === 'slaMinutes')?.min;
    expect(SlaAlertService.MIN_SLA_MINUTES).toBe(floor);
  });

  it('defaults to the current time when the scheduler passes none', async () => {
    // The scheduler calls `sweep()` with no argument; NOW is only injectable so the rest
    // of this file can pin a clock. Pin the real one to the same instant here.
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      await onTheRoad(200);
      expect(await service.sweep()).toMatchObject({ breached: 1, alerted: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("honours a depot's own tighter SLA rather than the global default", async () => {
    // A 30-minute depot: a 45-minute-old delivery is late here and early everywhere else.
    service = new SlaAlertService(repo, ops, buildTestConfig({ DELIVERY_SLA_MINUTES: '30' }));
    await onTheRoad(45);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ breached: 1, alerted: 1 });
    expect(ops.slaAlerts[0]).toMatchObject({ minutes: 45, thresholdMinutes: 30 });
  });
});
