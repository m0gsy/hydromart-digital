import { DepotProfileHttpAdapter } from '../../src/infrastructure/http/depot-profile.http.adapter';
import { UnservedDemandPrismaRepository } from '../../src/infrastructure/prisma/unserved-demand.prisma.repository';
import { buildTestConfig } from '../support/fakes';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
});
const setFetch = (impl: unknown) => {
  (globalThis as { fetch: unknown }).fetch = impl;
};

describe('DepotProfileHttpAdapter.listActive (HD-20b)', () => {
  const configured = buildTestConfig({ DEPOT_SERVICE_URL: 'http://depot:3007' });
  const page = (items: unknown[], totalPages: number) => ({
    ok: true,
    json: async () => ({ items, totalPages }),
  });

  it('walks every page and keeps the depots that can be placed', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(page([{ id: 'a', lat: 1, lng: 2, serviceRadiusKm: 3 }, { id: 'x' }], 2))
      .mockResolvedValueOnce(page([{ id: 'b', lat: 4, lng: 5 }], 2));
    setFetch(fetchMock);
    await expect(new DepotProfileHttpAdapter(configured).listActive()).resolves.toEqual([
      { id: 'a', lat: 1, lng: 2, serviceRadiusKm: 3, serviceArea: null },
      { id: 'b', lat: 4, lng: 5, serviceRadiusKm: 0, serviceArea: null },
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://depot:3007/api/v1/depots?limit=100&page=2&includeArea=true',
    );
  });

  it('stops after one page without totalPages, and reads a body without items as none', async () => {
    setFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(new DepotProfileHttpAdapter(configured).listActive()).resolves.toEqual([]);
  });

  it('is null, not a partial list, when the page cap is hit with pages left', async () => {
    const adapter = new DepotProfileHttpAdapter(configured);
    jest
      .spyOn((adapter as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    const fetchMock = jest.fn().mockResolvedValue(page([{ id: 'a', lat: 1, lng: 2 }], 999));
    setFetch(fetchMock);
    await expect(adapter.listActive()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });

  it('is null once the one 5 s deadline passes, however many pages were fast', async () => {
    jest.useFakeTimers();
    try {
      const adapter = new DepotProfileHttpAdapter(configured);
      jest
        .spyOn((adapter as unknown as { logger: { warn: () => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      setFetch(
        jest.fn((_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
        ),
      );
      const result = adapter.listActive();
      await jest.advanceTimersByTimeAsync(5000);
      await expect(result).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('is null when one page fails or depot-service is not configured', async () => {
    const adapter = new DepotProfileHttpAdapter(configured);
    jest
      .spyOn((adapter as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    setFetch(jest.fn().mockResolvedValueOnce(page([], 2)).mockResolvedValueOnce({ ok: false, status: 500 }));
    await expect(adapter.listActive()).resolves.toBeNull();
    await expect(new DepotProfileHttpAdapter(buildTestConfig({})).listActive()).resolves.toBeNull();
  });
});

describe('UnservedDemandPrismaRepository', () => {
  const row = {
    monthKey: '2026-11',
    kecamatanCode: '1',
    kelurahanCode: null,
    gridCell: '1:2',
    distanceBand: '1-3',
  };
  const marker = { customerId: 'c1', addressId: 'a1', latitude: -6.5, longitude: 6 };

  it('writes the row and the conditional marker in one transaction', async () => {
    const create = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const count = jest.fn().mockResolvedValue(0);
    const order: string[] = [];
    const $executeRaw = jest.fn(async () => void order.push('lock'));
    count.mockImplementation(async () => (order.push('count'), 0));
    const prisma = { $executeRaw, unservedDemand: { create }, address: { updateMany, count } };
    const $transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
    const repo = new UnservedDemandPrismaRepository({ $transaction } as never);
    await expect(repo.record(row, marker)).resolves.toBe(true);
    // the per-customer advisory lock comes before the count, so two parallel saves cannot both see 0
    expect(order).toEqual(['lock', 'count']);
    expect(String(($executeRaw.mock.calls[0] as unknown[][])[0].join(''))).toContain('pg_advisory_xact_lock');
    expect(count).toHaveBeenCalledWith({
      where: { customerId: 'c1', id: { not: 'a1' }, unservedMonth: '2026-11', kecamatanCode: row.kecamatanCode },
    });
    expect(create).toHaveBeenCalledWith({ data: row });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'a1',
        customerId: 'c1',
        latitude: -6.5,
        longitude: 6,
        kecamatanCode: { not: null },
        OR: [{ unservedMonth: null }, { unservedMonth: { not: '2026-11' } }],
      },
      data: { unservedMonth: '2026-11' },
    });
  });

  it('records nothing (the transaction throws, so the row rolls back) when the marker matches no row', async () => {
    const prisma = {
      $executeRaw: jest.fn(),
      unservedDemand: { create: jest.fn() },
      address: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), count: jest.fn().mockResolvedValue(0) },
    };
    const $transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
    const repo = new UnservedDemandPrismaRepository({ $transaction } as never);
    await expect(repo.record(row, marker)).resolves.toBe(false);
  });

  it('records nothing when another address of the same customer is already counted this month in the same kecamatan', async () => {
    const create = jest.fn();
    const updateMany = jest.fn();
    const prisma = { $executeRaw: jest.fn(), unservedDemand: { create }, address: { updateMany, count: jest.fn().mockResolvedValue(1) } };
    const $transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
    await expect(new UnservedDemandPrismaRepository({ $transaction } as never).record(row, marker)).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('lets any other failure through', async () => {
    const $transaction = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(new UnservedDemandPrismaRepository({ $transaction } as never).record(row, marker)).rejects.toThrow('db down');
  });
});
