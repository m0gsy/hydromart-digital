import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { buildPage } from '../../src/application/pagination';
import { DeliveryService } from '../../src/application/services/delivery.service';
import { ShiftService } from '../../src/application/services/shift.service';
import { DeliveryPrismaRepository } from '../../src/infrastructure/prisma/delivery.prisma.repository';
import { ContactMethod } from '../../src/domain/no-show';
import { DeliveryNotActiveError } from '../../src/domain/errors';
import {
  FakeCourierPayout,
  FakeOrderPayment,
  FakeDepotLocation,
  FakeOrderCoordination,
  InMemoryDeliveryRepository,
  InMemoryShiftRepository,
  buildTestConfig,
} from '../support/fakes';
import { DeliveryConfigService } from '../../src/config/delivery-config.service';
import { ReportService } from '../../src/application/services/report.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { SettlementService } from '../../src/application/services/settlement.service';
import { SETTING_DEF_BY_KEY } from '../../src/config/setting-defs';
import { SettlementNotFoundError } from '../../src/domain/errors';
import type { ConfigService } from '@nestjs/config';
import type { SettingsRepository } from '../../src/application/ports/settings.repository';

// The reads and the empty-set arithmetic: a depot that delivered nothing, a courier list that
// has to be ordered, a settlement that belongs to somebody else, and the per-depot tunables
// called with no depot at all (the network default).

// The depot FakeDepotLocation sits at; a check-in has to be inside its radius.
const DEPOT = '00000000-0000-4000-8000-000000000001';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };

const repoWith = (rows: SettingRow[]): SettingsRepository => {
  const store = [...rows] as (SettingRow & { updatedBy: string })[];
  return {
    loadAll: async () =>
      store.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value })),
    upsert: async (row) => {
      store.push(row);
    },
    remove: async () => undefined,
  };
};

describe('DeliveryConfigService with no depot', () => {
  it('falls back to the network value for every per-depot tunable', () => {
    const repo = repoWith([]);
    const cache = new SettingsCache(repo);
    const env = {
      get: jest.fn(() => undefined),
      getOrThrow: jest.fn(() => '30'),
    } as unknown as ConfigService;
    const config = new DeliveryConfigService(env, cache);

    expect(config.offlineMaxAgeHours()).toBeGreaterThan(0);
    expect(config.shiftCheckInRadiusMeters()).toBeGreaterThan(0);
    expect(config.shiftLengthHours()).toBeGreaterThan(0);
  });
});

describe('SettingsService rejects a per-depot override of a global-only setting', () => {
  it('names the key rather than writing a row nobody would ever read', async () => {
    SETTING_DEF_BY_KEY.networkOnlyKnob = {
      key: 'networkOnlyKnob',
      label: 'Global only',
      type: 'number',
      envDefault: 1,
      global: true,
    };
    try {
      const repo = repoWith([]);
      const svc = new SettingsService(repo, new SettingsCache(repo));
      await expect(
        svc.put({
          scope: 'DEPOT',
          depotId: 'dep-1',
          key: 'networkOnlyKnob',
          value: '2',
          updatedBy: 'u1',
        }),
      ).rejects.toThrow(/global-only/);
    } finally {
      delete SETTING_DEF_BY_KEY.networkOnlyKnob;
    }
  });
});

describe('SettlementService reads', () => {
  const settlement = { id: 's1', driverId: 'cou-1', depotId: 'dep-1' } as never;

  const service = (over: Record<string, unknown> = {}) =>
    new SettlementService(
      {
        listByDriver: jest.fn().mockResolvedValue([settlement]),
        findById: jest.fn().mockResolvedValue(settlement),
        search: jest.fn().mockResolvedValue([settlement]),
        ...over,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('lists a courier’s own settlement history', async () => {
    await expect(service().listForDriver('cou-1')).resolves.toEqual([settlement]);
  });

  it('reports another courier’s settlement as missing, never as forbidden', async () => {
    await expect(service().getForDriver('cou-1', 's1')).resolves.toBe(settlement);
    await expect(service().getForDriver('cou-2', 's1')).rejects.toBeInstanceOf(
      SettlementNotFoundError,
    );
    await expect(
      service({ findById: jest.fn().mockResolvedValue(null) }).getForDriver('cou-1', 'gone'),
    ).rejects.toBeInstanceOf(SettlementNotFoundError);
  });

  it('resolving a settlement that is not there is a not-found, never a crash', async () => {
    await expect(
      service({ findById: jest.fn().mockResolvedValue(null) }).verify(
        { sub: 'op-1', role: 'KEPALA_DEPOT', assignedDepotId: 'dep-1' } as never,
        'gone',
        {} as never,
      ),
    ).rejects.toBeInstanceOf(SettlementNotFoundError);
  });

  it('queues a depot with and without a status filter', async () => {
    const search = jest.fn().mockResolvedValue([settlement]);
    await service({ search }).searchForDepot('dep-1');
    await service({ search }).searchForDepot('dep-1', 'PENDING' as never);

    expect(search).toHaveBeenNthCalledWith(1, { depotId: 'dep-1', status: undefined });
    expect(search).toHaveBeenNthCalledWith(2, { depotId: 'dep-1', status: 'PENDING' });
  });
});

describe('ReportService arithmetic on empty sets', () => {
  const config = { slaMinutes: jest.fn().mockReturnValue(60) } as unknown as DeliveryConfigService;

  it('a depot that delivered nothing scores 0, and its average is null rather than NaN', async () => {
    const deliveries = {
      slaStatsByDepot: jest.fn().mockResolvedValue([
        { depotId: 'dep-1', totalDelivered: 0, onTime: 0, breached: 0, sumMinutes: 0 },
        { depotId: 'dep-2', totalDelivered: 4, onTime: 3, breached: 1, sumMinutes: 200 },
      ]),
    } as never;

    const report = await new ReportService(deliveries, {} as never, {} as never, config).slaByDepot({
      from: null,
      to: null,
    } as never);

    expect(report.depots[0]).toMatchObject({ slaRate: 0, avgMinutes: null });
    expect(report.depots[1]).toMatchObject({ slaRate: 0.75, avgMinutes: 50 });
  });

  it('orders couriers by deliveries, then by on-time rate, and rounds the rating', async () => {
    const at = (min: number) => new Date(Date.UTC(2026, 7, 1, 0, min));
    const delivery = (minutes: number, orderId: string) => ({
      orderId,
      assignedAt: at(0),
      deliveredAt: at(minutes),
    });
    const deliveries = {
      depotCourierActivityInWindow: jest.fn().mockResolvedValue([
        // Same delivered count as cou-2, worse on-time rate: must sort below it.
        { driverId: 'cou-1', delivered: [delivery(90, 'o1'), delivery(30, 'o2')], failed: 1 },
        { driverId: 'cou-2', delivered: [delivery(10, 'o3'), delivery(20, 'o4')], failed: 0 },
        { driverId: 'cou-3', delivered: [], failed: 0 },
      ]),
    } as never;
    const settlements = {
      verifiedByOperatorInWindow: jest.fn().mockResolvedValue([
        { operatorId: 'op-1', verifiedSettlements: 2 },
        { operatorId: 'op-2', verifiedSettlements: 9 },
      ]),
    } as never;
    const rating = {
      avgRating: jest
        .fn()
        .mockResolvedValueOnce({ average: 4.26, count: 2 })
        .mockResolvedValueOnce({ average: 4.9, count: 2 })
        .mockResolvedValueOnce({ average: null, count: 0 }),
    } as never;

    const report = await new ReportService(deliveries, settlements, rating, config).depotTeam(
      'dep-1',
      at(0),
      at(600),
    );

    expect(report.couriers.map((c) => c.driverId)).toEqual(['cou-2', 'cou-1', 'cou-3']);
    expect(report.couriers[1]).toMatchObject({ onTimeRate: 0.5, rating: 4.3, failed: 1 });
    // No deliveries at all: rate 0, not a division by zero, and no rating to round.
    expect(report.couriers[2]).toMatchObject({ onTimeRate: 0, rating: null });
    expect(report.operators.map((o) => o.operatorId)).toEqual(['op-2', 'op-1']);
  });
});

// The edges the happy path never reaches: a page built with no cursor, a ping read for a
// delivery that is gone, an ETA with nowhere to measure from, a contact attempt on a
// delivery that already ended, and a bucket that rejects a delete with something that is
// not an Error. Each is a real branch — none of them had a test.
describe('edges nothing else exercises', () => {
  it('builds a page with no next cursor when the caller does not pass one', () => {
    // Offset-paged reads (the console's tables) call this with four arguments; only the
    // keyset readers pass a cursor. Both must produce the same envelope shape.
    expect(buildPage([1, 2], 2, 1, 20)).toEqual({
      items: [1, 2],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
      nextCursor: null,
    });
  });

  it('reports a missing delivery as no ping state rather than a half-built row', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repo = new DeliveryPrismaRepository({ delivery: { findUnique } } as never);

    expect(await repo.findPingState('gone')).toBeNull();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gone' } }),
    );
  });

  it('gives no ETA when there is no ping and no depot to measure from', async () => {
    // A delivery with a destination but no origin: no GPS ping yet, and no depot on the
    // record (walk-in and legacy rows). An ETA would have to be invented, so there is none
    // — the customer UI shows no estimate rather than a wrong one.
    const repo = new InMemoryDeliveryRepository();
    const orders = new FakeOrderCoordination();
    const config = buildTestConfig();
    const shifts = new ShiftService(new InMemoryShiftRepository(), new FakeDepotLocation(), config);
    const service = new DeliveryService(
      repo,
      orders,
      new FakeCourierPayout(),
      shifts,
      config,
      new FakeDepotLocation(),
      new FakeOrderPayment(),
    );
    const driverId = randomUUID();
    await shifts.checkIn(driverId, DEPOT, AT_DEPOT.lat, AT_DEPOT.lng);
    const created = await service.assign(
      randomUUID(),
      {
        orderId: randomUUID(),
        orderNumber: 'HM-9',
        driverId,
        destinationAddress: 'Jl. Tanpa Depot 1',
        destinationLat: -6.2,
        destinationLng: 106.8,
      },
      'Bearer t',
    );
    await service.pickup(driverId, created.id, 'Bearer t');

    const onDelivery = await service.start(driverId, created.id, 'Bearer t');
    expect(onDelivery.estimatedArrivalAt ?? null).toBeNull();
  });

  it('refuses a contact attempt on a delivery that has already ended', async () => {
    const repo = new InMemoryDeliveryRepository();
    const config = buildTestConfig();
    const shifts = new ShiftService(new InMemoryShiftRepository(), new FakeDepotLocation(), config);
    const service = new DeliveryService(
      repo,
      new FakeOrderCoordination(),
      new FakeCourierPayout(),
      shifts,
      config,
      new FakeDepotLocation(),
      new FakeOrderPayment(),
    );
    const driverId = randomUUID();
    await shifts.checkIn(driverId, DEPOT, AT_DEPOT.lat, AT_DEPOT.lng);
    const created = await service.assign(
      randomUUID(),
      { orderId: randomUUID(), orderNumber: 'HM-10', driverId, destinationAddress: 'Jl. Sudah 2' },
      'Bearer t',
    );
    await service.pickup(driverId, created.id, 'Bearer t');
    await service.fail(driverId, created.id, 'alamat tidak ditemukan');

    // The no-show timer belongs to a delivery in progress. On a finished one the attempt
    // has nothing to count toward, so it is refused rather than silently recorded.
    await expect(
      service.recordContactAttempt(driverId, created.id, ContactMethod.CALL),
    ).rejects.toBeInstanceOf(DeliveryNotActiveError);
  });

  it('logs a non-Error rejection from the bucket and keeps purging', async () => {
    const repo = new InMemoryDeliveryRepository();
    const config = buildTestConfig();
    const shifts = new ShiftService(new InMemoryShiftRepository(), new FakeDepotLocation(), config);
    // Buckets reject with strings and with objects, not only with Errors — and the sweep
    // has to survive either, because the proof ROW is already deleted by then.
    const storage = { put: jest.fn(), remove: jest.fn().mockRejectedValue('403 Forbidden') };
    const service = new DeliveryService(
      repo,
      new FakeOrderCoordination(),
      new FakeCourierPayout(),
      shifts,
      config,
      new FakeDepotLocation(),
      new FakeOrderPayment(),
      storage as never,
    );
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const driverId = randomUUID();
    await shifts.checkIn(driverId, DEPOT, AT_DEPOT.lat, AT_DEPOT.lng);
    const created = await service.assign(
      randomUUID(),
      { orderId: randomUUID(), orderNumber: 'HM-11', driverId, destinationAddress: 'Jl. Bucket 3' },
      'Bearer t',
    );
    await service.pickup(driverId, created.id, 'Bearer t');
    await service.start(driverId, created.id, 'Bearer t');
    const done = await service.complete(
      driverId,
      created.id,
      {
        photoUrl: 'https://cdn/pod/x.jpg',
        signatureUrl: null,
        recipientName: 'Budi',
        latitude: -6.9147,
        longitude: 107.6098,
        note: null,
      },
      'Bearer t',
    );

    const later = new Date(done.proof!.capturedAt.getTime() + 366 * 86_400_000);
    expect(await service.purgeProofsOlderThan(later)).toEqual({ purged: 1 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
  });
});
