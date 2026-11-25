import { randomUUID } from 'node:crypto';

import { ServiceUnavailableException } from '@nestjs/common';

import { MaintenanceService } from '../../src/application/services/maintenance.service';
import { MeterVolumeHttpAdapter } from '../../src/infrastructure/http/meter-volume.http.adapter';
import { MaintenanceController } from '../../src/modules/maintenance.controller';
import { MaintenanceInternalController } from '../../src/modules/maintenance-internal.controller';
import { MaintenanceIntervalRequiredError, MaintenanceNextDueWithoutIntervalError } from '../../src/domain/errors';
import {
  deriveMaintenanceStatus,
  dueByOf,
  MaintenanceItem,
  MaintenanceStatus,
} from '../../src/domain/maintenance';
import { MaintenanceRepository } from '../../src/application/ports/maintenance.repository';

/*
 * HD-15: an item is due by days OR by water volume, whichever comes first. The volume comes from
 * order-service's closed meter days after the service day, up to yesterday (WIB).
 */
const DEPOT = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;
// 2026-11-25 10:00 WIB
const NOW = new Date('2026-11-25T03:00:00.000Z');

class Repo implements MaintenanceRepository {
  rows: MaintenanceItem[] = [];
  async create(data: Parameters<MaintenanceRepository['create']>[0]) {
    const row: MaintenanceItem = {
      id: randomUUID(),
      ...data,
      status: MaintenanceStatus.HEALTHY,
      createdAt: new Date('2026-10-01T03:00:00.000Z'),
      updatedAt: NOW,
    };
    this.rows.push(row);
    return { ...row };
  }
  async listForDepot(depotId: string) {
    return this.rows.filter((r) => r.depotId === depotId).map((r) => ({ ...r }));
  }
  async listAllActive() {
    return this.rows.map((r) => ({ ...r, depotName: 'Cikini' }));
  }
  async findById(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async update(id: string, data: Parameters<MaintenanceRepository['update']>[1]) {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, data);
    return { ...r };
  }
}

type Vol = { m3: number; readingDays: number; spanDays: number } | null;

function build(volume: (r: { from: string; to: string }) => Vol) {
  const repo = new Repo();
  const meter = {
    volumes: jest.fn(async (rs: readonly { depotId: string; from: string; to: string }[]) =>
      rs.map(volume),
    ),
  };
  const service = new MaintenanceService(repo, { exists: async () => true } as never, meter);
  return { repo, meter, service };
}
const base = { depotId: DEPOT, name: 'Membran RO', category: 'RO' };

describe('dueByOf and status', () => {
  const item = { intervalDays: 90, intervalM3: 500, nextDueAt: new Date(NOW.getTime() + 10 * DAY) };
  it('is not due below both limits, and a missing meter figure never says due', () => {
    expect(dueByOf(item, 80, 499.9, NOW)).toBeNull();
    expect(dueByOf(item, 80, null, NOW)).toBeNull();
  });
  it('names the limit that was reached, volume at exactly the limit', () => {
    expect(dueByOf(item, 80, 500, NOW)).toBe('VOLUME');
    expect(dueByOf({ ...item, nextDueAt: new Date(NOW.getTime() - DAY) }, 91, 100, NOW)).toBe(
      'DAYS',
    );
  });
  it('names the one overshot by the larger share when both are past', () => {
    const past = { ...item, nextDueAt: new Date(NOW.getTime() - DAY) };
    expect(dueByOf(past, 100, 900, NOW)).toBe('VOLUME');
    expect(dueByOf(past, 200, 520, NOW)).toBe('DAYS');
    expect(dueByOf({ ...past, intervalDays: null }, 200, 520, NOW)).toBe('VOLUME');
  });
  it('a volume-only item has no date: DUE by volume, else NEW or HEALTHY', () => {
    expect(deriveMaintenanceStatus(null, null, NOW, 14, true)).toBe(MaintenanceStatus.DUE);
    expect(deriveMaintenanceStatus(null, new Date(NOW.getTime() - DAY), NOW)).toBe(
      MaintenanceStatus.NEW,
    );
    expect(deriveMaintenanceStatus(null, null, NOW)).toBe(MaintenanceStatus.HEALTHY);
  });
});

describe('MaintenanceService (HD-15)', () => {
  it('asks for the complete WIB days after the service day up to yesterday, and reports missing days', async () => {
    const { service, meter } = build(() => ({ m3: 520.25, readingDays: 40, spanDays: 43 }));
    const lastServicedAt = new Date('2026-10-13T08:00:00.000Z'); // 15:00 WIB on 13 Oct
    const item = await service.create({ ...base, intervalM3: 500, lastServicedAt }, NOW);
    expect(meter.volumes).toHaveBeenCalledWith([
      { depotId: DEPOT, from: '2026-10-14', to: '2026-11-24' },
    ], false);
    expect(item).toMatchObject({
      intervalDays: null,
      nextDueAt: null,
      m3SinceService: 520.25,
      meterDaysMissing: 3,
      dueBy: 'VOLUME',
      status: MaintenanceStatus.DUE,
      daysSinceService: 42,
    });
  });

  it('is not due by volume below the limit, even with days far off', async () => {
    const { service } = build(() => ({ m3: 100, readingDays: 10, spanDays: 10 }));
    const item = await service.create({ ...base, intervalM3: 500, intervalDays: 365 }, NOW);
    expect(item).toMatchObject({ dueBy: null, m3SinceService: 100, status: MaintenanceStatus.HEALTHY });
    expect(item.nextDueAt).toEqual(new Date(NOW.getTime() + 365 * DAY));
  });

  it('is due by days when the date has passed although the volume is low', async () => {
    const { service } = build(() => ({ m3: 1, readingDays: 1, spanDays: 1 }));
    const item = await service.create(
      { ...base, intervalM3: 500, intervalDays: 30, nextDueAt: new Date(NOW.getTime() - DAY) },
      NOW,
    );
    expect(item.dueBy).toBe('DAYS');
  });

  it('says the volume is unknown (null, not 0) when order-service cannot answer, and asks nobody about an empty range', async () => {
    const down = build(() => null);
    const a = await down.service.create({ ...base, intervalM3: 500 }, NOW);
    expect(a).toMatchObject({ m3SinceService: null, meterDaysMissing: null, dueBy: null });
    const fresh = build(() => null);
    const b = await fresh.service.create(
      { ...base, intervalM3: 500, lastServicedAt: new Date(NOW.getTime() - 3_600_000) },
      NOW,
    );
    expect(b).toMatchObject({ m3SinceService: 0, meterDaysMissing: 0, dueBy: null });
    expect(fresh.meter.volumes).not.toHaveBeenCalled();
  });

  it('does not ask the meter for an item with no volume limit', async () => {
    const { service, meter } = build(() => null);
    const item = await service.create({ ...base, intervalDays: 30 }, NOW);
    expect(meter.volumes).not.toHaveBeenCalled();
    expect(item).toMatchObject({ m3SinceService: null, meterDaysMissing: null, intervalM3: null });
  });

  it('asks once for items of one depot serviced the same day', async () => {
    const { service, meter } = build(() => ({ m3: 10, readingDays: 1, spanDays: 1 }));
    const lastServicedAt = new Date('2026-10-13T08:00:00.000Z');
    await service.create({ ...base, name: 'a', intervalM3: 500, lastServicedAt }, NOW);
    await service.create({ ...base, name: 'b', intervalM3: 800, lastServicedAt }, NOW);
    const list = await service.list(DEPOT, NOW);
    expect(list.map((i) => i.m3SinceService)).toEqual([10, 10]);
    expect(meter.volumes).toHaveBeenLastCalledWith([{ depotId: DEPOT, from: '2026-10-14', to: '2026-11-24' }], false);
  });

  it('the due sweep reads the meter strictly, so an outage is an error and never "nothing due"', async () => {
    const { service, meter } = build(() => ({ m3: 600, readingDays: 1, spanDays: 1 }));
    await service.create({ ...base, intervalM3: 500, lastServicedAt: new Date('2026-10-13T08:00:00.000Z') }, NOW);
    await service.due(NOW);
    expect(meter.volumes).toHaveBeenLastCalledWith(expect.any(Array), true);
    meter.volumes.mockRejectedValueOnce(new Error('meter down'));
    await expect(service.due(NOW)).rejects.toThrow('meter down');
  });

  it('refuses a next-due date with no day interval instead of dropping it', async () => {
    const { service } = build(() => null);
    await expect(service.create({ ...base, intervalM3: 500, nextDueAt: NOW }, NOW)).rejects.toBeInstanceOf(
      MaintenanceNextDueWithoutIntervalError,
    );
  });

  it('requires at least one limit', async () => {
    const { service } = build(() => null);
    await expect(service.create({ ...base }, NOW)).rejects.toBeInstanceOf(
      MaintenanceIntervalRequiredError,
    );
  });

  it('marks a volume-only item serviced: no date, volume restarts at zero', async () => {
    const { service } = build(() => ({ m3: 0, readingDays: 0, spanDays: 0 }));
    const item = await service.create({ ...base, intervalM3: 500 }, NOW);
    const done = await service.markServiced(item.id, NOW);
    expect(done).toMatchObject({ nextDueAt: null, lastServicedAt: NOW, m3SinceService: 0 });
  });

  it('lists the due items of the network with their depot name; the internal route says where the cycle started', async () => {
    const { service, repo } = build((r) =>
      r.from === '2026-10-14'
        ? { m3: 600, readingDays: 42, spanDays: 42 }
        : { m3: 1, readingDays: 1, spanDays: 1 },
    );
    await service.create(
      { ...base, name: 'Lama', intervalM3: 500, lastServicedAt: new Date('2026-10-13T08:00:00.000Z') },
      NOW,
    );
    await service.create(
      { ...base, name: 'Baru', intervalM3: 500, lastServicedAt: new Date('2026-11-01T08:00:00.000Z') },
      NOW,
    );
    expect(repo.rows).toHaveLength(2);
    const due = await service.due(NOW);
    expect(due.map((d) => [d.name, d.depotName, d.dueBy])).toEqual([['Lama', 'Cikini', 'VOLUME']]);
    const out = await new MaintenanceInternalController({ due: async () => due } as never).due();
    expect(out.items).toEqual([
      expect.objectContaining({
        name: 'Lama',
        depotName: 'Cikini',
        dueBy: 'VOLUME',
        m3SinceService: 600,
        intervalM3: 500,
        cycleStart: '2026-10-13',
      }),
    ]);
  });

  it('the create route passes a volume-only item with no date, and the due route falls back to the day it was added', async () => {
    const create = jest.fn();
    await new MaintenanceController({ create } as never).create({ depotId: DEPOT, name: 'n', category: 'c', intervalM3: 5 } as never);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ intervalDays: null, intervalM3: 5, nextDueAt: undefined }));
    const added = new Date('2026-10-01T03:00:00.000Z');
    const out = await new MaintenanceInternalController({
      due: async () => [{ id: 'x', depotId: DEPOT, depotName: 'D', name: 'n', category: 'c', dueBy: 'DAYS', daysSinceService: 1, m3SinceService: null, intervalDays: 1, intervalM3: null, lastServicedAt: null, createdAt: added }],
    } as never).due();
    expect(out.items[0].cycleStart).toBe('2026-10-01');
  });

  it('gets one item or says it is not there', async () => {
    const { service } = build(() => null);
    const made = await service.create({ ...base, intervalDays: 30 }, NOW);
    expect((await service.get(made.id)).id).toBe(made.id);
  });

  it('defaults `now` on the read paths', async () => {
    const { service } = build(() => null);
    await service.create({ ...base, intervalDays: 30 });
    expect(await service.list(DEPOT)).toHaveLength(1);
    expect(await service.due()).toEqual([]);
  });
});

describe('MeterVolumeHttpAdapter', () => {
  const config = { orderServiceUrl: 'http://order', internalServiceKey: 'k' };
  const range = { depotId: DEPOT, from: '2026-10-14', to: '2026-11-24' };
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('posts the ranges with the internal key and maps the answers in order', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ m3: 1.5, readingDays: 2, spanDays: 3 }, { m3: 'x' }] }),
    });
    const out = await new MeterVolumeHttpAdapter(config as never).volumes([range, range]);
    expect(out).toEqual([{ m3: 1.5, readingDays: 2, spanDays: 3 }, null]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order/api/v1/reports/internal/meter-volume',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': 'k' }),
      }),
    );
  });

  it('throws 503 instead of nulls when asked strictly, and sends at most 200 ranges a call', async () => {
    const adapter = new MeterVolumeHttpAdapter(config as never);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(adapter.volumes([range], true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(new MeterVolumeHttpAdapter({ orderServiceUrl: '', internalServiceKey: 'k' } as never).volumes([range], true)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_u: string, init: { body: string }) => ({
      ok: true,
      json: async () => ({ items: JSON.parse(init.body).ranges.map(() => ({ m3: 1, readingDays: 1, spanDays: 1 })) }),
    }));
    const out = await adapter.volumes(Array.from({ length: 450 }, () => range));
    expect(out).toHaveLength(450);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).ranges).toHaveLength(200);
  });

  it('answers all null when unconfigured, empty, refused, malformed or unreachable', async () => {
    expect(
      await new MeterVolumeHttpAdapter({ orderServiceUrl: '', internalServiceKey: 'k' } as never).volumes([range]),
    ).toEqual([null]);
    const adapter = new MeterVolumeHttpAdapter(config as never);
    expect(await adapter.volumes([])).toEqual([]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await adapter.volumes([range])).toEqual([null]);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
    expect(await adapter.volumes([range])).toEqual([null]);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await adapter.volumes([range])).toEqual([null]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
