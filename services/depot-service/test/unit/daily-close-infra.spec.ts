import { ServiceUnavailableException } from '@nestjs/common';

import { CourierCodHttpAdapter } from '../../src/infrastructure/http/courier-cod.http.adapter';
import { DailyClosePrismaRepository } from '../../src/infrastructure/prisma/daily-close.prisma.repository';
import { DailyCloseController } from '../../src/modules/daily-close.controller';

/**
 * The courier half of a depot's takings. Fails CLOSED like the payment adapter beside it:
 * a day closed with COD silently missing records a total nobody can reproduce.
 */
describe('CourierCodHttpAdapter', () => {
  const configured = {
    deliveryServiceUrl: 'http://delivery:3006',
    internalServiceKey: 'k',
  } as never;
  const blank = { deliveryServiceUrl: '', internalServiceKey: '' } as never;
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const from = new Date('2026-08-04T00:00:00.000Z');
  const to = new Date('2026-08-05T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('refuses to answer at all when delivery-service is not configured', async () => {
    await expect(
      new CourierCodHttpAdapter(blank).depositedInWindow('d1', from, to),
    ).rejects.toThrow('DELIVERY_SERVICE_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for the window and returns the three numbers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ depositedIdr: 500_000, expectedIdr: 520_000, settlements: 3 }),
    });

    const out = await new CourierCodHttpAdapter(configured).depositedInWindow('d1', from, to);

    expect(out).toEqual({ depositedIdr: 500_000, expectedIdr: 520_000, settlements: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/settlements/internal/deposited?depotId=d1');
    expect(String(url)).toContain('from=2026-08-04T00%3A00%3A00.000Z');
    expect(init.headers['x-internal-key']).toBe('k');
  });

  // A partial answer must not become a confident zero inside a signed-off total.
  it('reads a missing field as zero rather than NaN', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(
      new CourierCodHttpAdapter(configured).depositedInWindow('d1', from, to),
    ).resolves.toEqual({ depositedIdr: 0, expectedIdr: 0, settlements: 0 });
  });

  it('raises when delivery-service refuses or cannot be reached', async () => {
    const adapter = new CourierCodHttpAdapter(configured);

    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(adapter.depositedInWindow('d1', from, to)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter.depositedInWindow('d1', from, to)).rejects.toThrow('tidak terjangkau');
  });
});

describe('DailyClosePrismaRepository', () => {
  const row = {
    id: 'close-1',
    depotId: 'd1',
    businessDate: new Date('2026-08-04T00:00:00.000Z'),
    closedAt: new Date('2026-08-04T15:00:00.000Z'),
    closedBy: 'kd-1',
    cashInIdr: 300_000,
    cashOutIdr: 50_000,
    konterIdr: 300_000,
    codDepositedIdr: 500_000,
    codExpectedIdr: 520_000,
    note: null,
    reopenedAt: null,
    reopenedBy: null,
  };
  const depotDailyClose = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    // Declared with its argument: a zero-arg `jest.fn` types `mock.calls` as `[][]`, and the
    // assertion below reads calls[0][0] to check the upsert key.
    upsert: jest.fn(async (_args: unknown) => row),
    update: jest.fn(async () => ({ ...row, reopenedAt: new Date(), reopenedBy: 'hq-1' })),
  };
  const repo = new DailyClosePrismaRepository({ depotDailyClose } as never);

  beforeEach(() => jest.clearAllMocks());

  it('hands the business date back as the YYYY-MM-DD it was asked with', async () => {
    depotDailyClose.findUnique.mockResolvedValue(row);

    await expect(repo.find('d1', '2026-08-04')).resolves.toMatchObject({
      businessDate: '2026-08-04',
      konterIdr: 300_000,
    });
  });

  it('reports an unclosed day as null', async () => {
    depotDailyClose.findUnique.mockResolvedValue(null);
    await expect(repo.find('d1', '2026-08-04')).resolves.toBeNull();
  });

  it('lists a range of closed days oldest first, mapping each business date', async () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-09-01T00:00:00.000Z');
    depotDailyClose.findMany.mockResolvedValue([row]);
    await expect(repo.listForDepotRange('d1', from, to)).resolves.toEqual([
      expect.objectContaining({ businessDate: '2026-08-04', codExpectedIdr: 520_000 }),
    ]);
    expect(depotDailyClose.findMany).toHaveBeenCalledWith({
      where: { depotId: 'd1', businessDate: { gte: from, lt: to } },
      orderBy: { businessDate: 'asc' },
    });
  });

  // Upsert, so re-closing a reopened day replaces the snapshot instead of adding a second
  // answer to "what did this depot take".
  it('upserts on (depot, day) and clears the reopen marks', async () => {
    await repo.close({
      depotId: 'd1',
      businessDate: '2026-08-04',
      closedBy: 'kd-1',
      cashInIdr: 1,
      cashOutIdr: 2,
      konterIdr: 3,
      codDepositedIdr: 4,
      codExpectedIdr: 5,
      note: 'ok',
    });

    const arg = depotDailyClose.upsert.mock.calls[0][0] as {
      where: { depotId_businessDate: { depotId: string } };
      create: { note: string | null };
      update: { reopenedAt: Date | null; reopenedBy: string | null };
    };
    expect(arg.where.depotId_businessDate.depotId).toBe('d1');
    expect(arg.update.reopenedAt).toBeNull();
    expect(arg.update.reopenedBy).toBeNull();
    expect(arg.create.note).toBe('ok');
  });

  it('marks a reopen rather than deleting the row', async () => {
    const out = await repo.reopen('d1', '2026-08-04', 'hq-1');
    expect(depotDailyClose.update).toHaveBeenCalled();
    expect(out.reopenedBy).toBe('hq-1');
  });
});

describe('DailyCloseController (delegation)', () => {
  const service = {
    get: jest.fn(async () => ({ close: null, lateEntries: 0, lateAmountIdr: 0 })),
    close: jest.fn(async () => ({ id: 'close-1' })),
    reopen: jest.fn(async () => ({ id: 'close-1' })),
  };
  const ctrl = new DailyCloseController(service as never);
  const user = { sub: 'kd-1', role: 'KEPALA_DEPOT', phone: null, depotId: 'd1' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('passes the caller through on read and close, so the depot check runs in the service', async () => {
    await ctrl.get('d1', { businessDate: '2026-08-04' }, user);
    expect(service.get).toHaveBeenCalledWith(user, 'd1', '2026-08-04');

    await ctrl.close('d1', { businessDate: '2026-08-04', note: 'ok' }, user);
    expect(service.close).toHaveBeenCalledWith(user, 'd1', '2026-08-04', 'ok');
  });

  it('sends a null note when none was typed', async () => {
    await ctrl.close('d1', { businessDate: '2026-08-04' }, user);
    expect(service.close).toHaveBeenCalledWith(user, 'd1', '2026-08-04', null);
  });

  // Reopening carries the ACTOR, not the caller object: the row records who did it.
  it('reopens with the actor id', async () => {
    await ctrl.reopen('d1', { businessDate: '2026-08-04' }, { sub: 'hq-1' } as never);
    expect(service.reopen).toHaveBeenCalledWith('d1', '2026-08-04', 'hq-1');
  });
});
