import { randomUUID } from 'node:crypto';

import { AuthenticatedUser, SettingRow } from '@hydromart/platform';

import { SlaAlertService } from '../../src/application/services/sla-alert.service';
import { DeliveryService } from '../../src/application/services/delivery.service';
import { ShiftService } from '../../src/application/services/shift.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { isOnTime, onTimeOf, slaClockStart } from '../../src/domain/sla';
import {
  FakeCourierPayout,
  FakeDepotLocation,
  FakeOrderCoordination,
  FakeOpsNotifier,
  FakeOrderLookup,
  FakeOrderPayment,
  InMemoryDeliveryRepository,
  InMemoryShiftRepository,
  buildTestConfig,
} from '../support/fakes';

/**
 * HD-6 #19/#20 - the on-time verdict is stored when a delivery completes, on the clock of the
 * attempt that succeeded and the threshold of its depot (else the global setting).
 */
const AUTH = 'Bearer token';
const DEPOT = '00000000-0000-4000-8000-000000000001';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };
const PROOF = {
  photoUrl: 'https://cdn/pod/x.jpg',
  signatureUrl: null,
  sealIntact: true,
  recipientName: 'Budi',
  latitude: AT_DEPOT.lat,
  longitude: AT_DEPOT.lng,
  note: null,
};
const T0 = new Date('2026-11-25T01:00:00.000Z').getTime();
const min = (m: number): number => T0 + m * 60_000;

/** A repository that completes the way every row did BEFORE HD-6: no verdict is written. */
class PreHd6Repo extends InMemoryDeliveryRepository {
  override async completeWithProof(
    id: string,
    from: DeliveryStatus,
    proof: Parameters<InMemoryDeliveryRepository['completeWithProof']>[2],
    changedBy: string,
    capturedAt: Date,
  ): ReturnType<InMemoryDeliveryRepository['completeWithProof']> {
    return super.completeWithProof(id, from, proof, changedBy, capturedAt);
  }
}

describe('stored on-time verdict', () => {
  const driver = randomUUID();
  const driver2 = randomUUID();
  const staff = randomUUID();
  let repo: InMemoryDeliveryRepository;
  let payout: FakeCourierPayout;
  let service: DeliveryService;

  async function build(
    opts: {
      repo?: InMemoryDeliveryRepository;
      settings?: { depot?: number; global?: number };
    } = {},
  ): Promise<void> {
    repo = opts.repo ?? new InMemoryDeliveryRepository();
    payout = new FakeCourierPayout();
    const rows: SettingRow[] = [];
    if (opts.settings?.depot !== undefined) {
      rows.push({
        scope: 'DEPOT',
        depotId: DEPOT,
        key: 'slaMinutes',
        value: String(opts.settings.depot),
      });
    }
    if (opts.settings?.global !== undefined) {
      rows.push({
        scope: 'GLOBAL',
        depotId: null,
        key: 'slaMinutes',
        value: String(opts.settings.global),
      });
    }
    const config = buildTestConfig({}, rows);
    const depots = new FakeDepotLocation();
    const shifts = new ShiftService(new InMemoryShiftRepository(), repo, depots, config);
    service = new DeliveryService(
      repo,
      new FakeOrderCoordination(),
      payout,
      shifts,
      config,
      depots,
      new FakeOrderPayment(),
      new FakeOrderLookup(),
    );
    jest.setSystemTime(min(0));
    await shifts.checkIn(driver, DEPOT, AT_DEPOT.lat, AT_DEPOT.lng);
    await shifts.checkIn(driver2, DEPOT, AT_DEPOT.lat, AT_DEPOT.lng);
  }

  beforeEach(() => jest.useFakeTimers({ now: T0 }));
  afterEach(() => jest.useRealTimers());

  // The in-memory repo stamps assignedAt from its own counter; pin it to the test clock so
  // "assigned at T0" means the same instant the service reads with Date.now().
  const assign = async (d: string, orderId: string = randomUUID()) => {
    const row = await service.assign(
      staff,
      {
        orderId,
        orderNumber: 'HM-1',
        driverId: d,
        depotId: DEPOT,
        destinationAddress: 'Jl. Merdeka 10',
      },
      AUTH,
    );
    const stored = repo.rows.find((r) => r.id === row.id)!;
    if (stored.history.length === 1) stored.assignedAt = new Date(Date.now());
    return { ...row, assignedAt: stored.assignedAt };
  };
  const run = async (d: string, id: string): Promise<void> => {
    await service.pickup(d, id, AUTH);
    await service.start(d, id, AUTH);
  };
  // The earning push is fire-and-forget; let it land before reading the payout double.
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  it('stores start, threshold and verdict on a first-attempt success', async () => {
    await build();
    const d = await assign(driver);
    await run(driver, d.id);
    jest.setSystemTime(min(100));
    const done = await service.complete(driver, d.id, PROOF, AUTH);
    expect(done.slaStartedAt?.getTime()).toBe(min(0));
    expect(done.slaThresholdMinutes).toBe(120);
    expect(done.slaOnTime).toBe(true);
    await flush();
    expect(payout.events[0].onTime).toBe(true);
  });

  it('marks a delivery past the threshold as late, in the row and in the pay', async () => {
    await build();
    const d = await assign(driver);
    await run(driver, d.id);
    jest.setSystemTime(min(121));
    const done = await service.complete(driver, d.id, PROOF, AUTH);
    expect(done.slaOnTime).toBe(false);
    await flush();
    expect(payout.events[0].onTime).toBe(false);
  });

  it('a customer reschedule restarts the clock; the wait is not the courier fault', async () => {
    await build();
    const d = await assign(driver);
    await run(driver, d.id);
    await service.reschedule(driver, d.id, { rescheduledFor: new Date(min(60 * 5)) });
    jest.setSystemTime(min(60 * 5)); // five hours later the dispatcher re-opens it
    const again = await assign(driver, d.orderId);
    expect(again.id).toBe(d.id);
    expect(again.slaStartedAt?.getTime()).toBe(min(300));
    await run(driver, d.id);
    jest.setSystemTime(min(300 + 30));
    const done = await service.complete(driver, d.id, PROOF, AUTH);
    expect(done.slaStartedAt?.getTime()).toBe(min(300));
    expect(done.slaOnTime).toBe(true); // 30 min on its own clock, 330 on the old one
    await flush();
    expect(payout.events[0].onTime).toBe(true);
  });

  it('a customer reschedule re-opened for another courier restarts once, completing does not move it', async () => {
    await build();
    const d = await assign(driver);
    await service.reschedule(driver, d.id, { rescheduledFor: new Date(min(200)) });
    jest.setSystemTime(min(200));
    const reopened = await assign(driver2, d.orderId);
    expect(reopened.driverId).toBe(driver2);
    expect(slaClockStart(reopened).getTime()).toBe(min(200));
    await run(driver2, d.id);
    jest.setSystemTime(min(260));
    const done = await service.complete(driver2, d.id, PROOF, AUTH);
    expect(done.slaStartedAt?.getTime()).toBe(min(200));
    expect(done.slaOnTime).toBe(true);
  });

  describe('threshold precedence', () => {
    const completeAt = async (afterMin: number) => {
      const d = await assign(driver);
      await run(driver, d.id);
      jest.setSystemTime(min(afterMin));
      return service.complete(driver, d.id, PROOF, AUTH);
    };

    it('the depot setting wins over the global setting', async () => {
      await build({ settings: { depot: 30, global: 90 } });
      const done = await completeAt(60);
      expect(done.slaThresholdMinutes).toBe(30);
      expect(done.slaOnTime).toBe(false);
    });

    it('without a depot setting the global setting /hq/sla-policy saves applies', async () => {
      await build({ settings: { global: 90 } });
      const done = await completeAt(60);
      expect(done.slaThresholdMinutes).toBe(90);
      expect(done.slaOnTime).toBe(true);
    });

    it('with neither, the env default applies', async () => {
      await build();
      expect((await completeAt(60)).slaThresholdMinutes).toBe(120);
    });
  });

  describe('forward-only: rows without a stored verdict', () => {
    it('courier pay for a row completed before HD-6 is graded as it always was', async () => {
      // The null row keeps today's rule: assignedAt clock, the depot's own threshold chain.
      await build({ repo: new PreHd6Repo() });
      const d = await assign(driver);
      await run(driver, d.id);
      jest.setSystemTime(min(60));
      const done = await service.complete(driver, d.id, PROOF, AUTH);
      expect(done.slaOnTime).toBeNull();
      await flush();
      expect(payout.events[0].onTime).toBe(true);
    });

    it('onTimeOf uses the stored verdict, and only computes when there is none', () => {
      const row = { assignedAt: new Date(min(0)), deliveredAt: new Date(min(100)) };
      expect(onTimeOf({ ...row, slaOnTime: false }, 120)).toBe(false);
      expect(onTimeOf({ ...row, slaOnTime: true }, 10)).toBe(true);
      expect(onTimeOf({ ...row, slaOnTime: null }, 120)).toBe(true);
      expect(onTimeOf({ ...row, slaOnTime: null }, 60)).toBe(false);
      expect(isOnTime(new Date(min(0)), new Date(min(60)), 60)).toBe(true);
    });
  });

  describe('readers prefer the stored verdict', () => {
    it('slaStats counts the stored verdict, computing only for null rows', async () => {
      await build();
      const seed = await assign(driver);
      const base = {
        depotId: DEPOT,
        status: DeliveryStatus.DELIVERED,
        assignedAt: new Date(min(0)),
        deliveredAt: new Date(min(100)),
      };
      repo.rows.length = 0;
      for (const slaOnTime of [null, false, true, null]) {
        repo.rows.push({ ...seed, ...base, slaOnTime, id: randomUUID() });
      }
      const s = await repo.slaStats({}, 120);
      expect(s.totalDelivered).toBe(4);
      expect(s.onTime).toBe(3); // 100 min: two computed on time, one stored true, one stored late
      const byDepot = await repo.slaStatsByDepot({}, 60);
      expect(byDepot[0].onTime).toBe(1); // only the stored-true row; null rows fail at 60
    });
  });

  describe('who asked for the reschedule', () => {
    const depotStaff: AuthenticatedUser = {
      sub: 'staff-1',
      role: 'KEPALA_DEPOT' as never,
      phone: '08',
      depotId: DEPOT,
    };

    it('the courier endpoint reschedule is stored as a CUSTOMER request', async () => {
      await build();
      const d = await assign(driver);
      const out = await service.reschedule(driver, d.id, { rescheduledFor: new Date(min(200)) });
      expect(out.rescheduleInitiator).toBe('CUSTOMER');
    });

    it('a depot release to swap the courier keeps the clock running from the first assignment', async () => {
      await build();
      const d = await assign(driver);
      jest.setSystemTime(min(50));
      const released = await service.releaseByStaff(depotStaff, d.id, 'HP kurir mati', AUTH);
      expect(released.rescheduleInitiator).toBe('DEPOT');
      jest.setSystemTime(min(60));
      const reopened = await assign(driver2, d.orderId);
      expect(reopened.slaStartedAt).toBeNull(); // not restarted
      await run(driver2, d.id);
      jest.setSystemTime(min(130)); // 130 min since the FIRST assignment: late at 120
      const done = await service.complete(driver2, d.id, PROOF, AUTH);
      expect(done.slaStartedAt?.getTime()).toBe(min(0));
      expect(done.slaOnTime).toBe(false);
    });

    it('a row rescheduled before the initiator existed (null) is not restarted either', async () => {
      await build();
      const d = await assign(driver);
      await service.reschedule(driver, d.id, { rescheduledFor: new Date(min(200)) });
      repo.rows.find((r) => r.id === d.id)!.rescheduleInitiator = null;
      jest.setSystemTime(min(200));
      expect((await assign(driver, d.orderId)).slaStartedAt).toBeNull();
    });
  });

  describe('the late-delivery alert follows the same clock', () => {
    it('does not alert a delivery re-opened today after a reschedule three days ago', async () => {
      await build();
      const ops = new FakeOpsNotifier();
      const sweeper = new SlaAlertService(repo, ops, buildTestConfig());
      const d = await assign(driver);
      await service.reschedule(driver, d.id, { rescheduledFor: new Date(min(3 * 24 * 60)) });
      jest.setSystemTime(min(3 * 24 * 60));
      await assign(driver, d.orderId);
      // assignedAt is three days old, but the attempt now running began a moment ago.
      repo.rows.find((r) => r.id === d.id)!.assignedAt = new Date(min(0));
      const result = await sweeper.sweep(new Date(min(3 * 24 * 60 + 20)));
      expect(result).toMatchObject({ breached: 0, alerted: 0 });
      expect(ops.slaAlerts).toHaveLength(0);
    });

    it('re-opening clears an alert already sent, so the new attempt is judged afresh', async () => {
      await build();
      const ops = new FakeOpsNotifier();
      const sweeper = new SlaAlertService(repo, ops, buildTestConfig());
      const d = await assign(driver);
      jest.setSystemTime(min(200));
      expect(await sweeper.sweep(new Date(min(200)))).toMatchObject({ alerted: 1 });
      await service.reschedule(driver, d.id, { rescheduledFor: new Date(min(300)) });
      jest.setSystemTime(min(300));
      await assign(driver, d.orderId);
      expect(await sweeper.sweep(new Date(min(300 + 130)))).toMatchObject({ alerted: 1 });
    });
  });

  it('counts stored verdicts so a report can say how many rows ignore its threshold', async () => {
    await build();
    const seed = await assign(driver);
    repo.rows.length = 0;
    const base = {
      depotId: DEPOT,
      status: DeliveryStatus.DELIVERED,
      assignedAt: new Date(min(0)),
      deliveredAt: new Date(min(100)),
    };
    for (const slaOnTime of [true, null, null]) {
      repo.rows.push({ ...seed, ...base, slaOnTime, id: randomUUID() });
    }
    expect((await repo.slaStats({}, 120)).storedVerdicts).toBe(1);
    expect((await repo.slaStatsByDepot({}, 120))[0].storedVerdicts).toBe(1);
  });
});
