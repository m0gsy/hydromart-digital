import { DepotConfigService } from '../../src/config/depot-config.service';
import { CashTotalUnavailableError } from '../../src/domain/errors';
import { DepotCashHttpAdapter } from '../../src/infrastructure/http/depot-cash.http.adapter';

// This number decides whether a cashier is short. Every failure path here must throw, never
// answer 0 — a silent zero books the whole day's takings as a shortfall against a person.

const FROM = new Date('2026-08-03T01:00:00.000Z');
const TO = new Date('2026-08-03T09:00:00.000Z');

function makeConfig(over: Partial<Record<string, unknown>> = {}): DepotConfigService {
  return {
    paymentServiceUrl: 'http://payment:3005',
    internalServiceKey: 'internal-key-01',
    ...over,
  } as unknown as DepotConfigService;
}

function res(init: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throwJson?: boolean;
}): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => {
      if (init.throwJson) throw new Error('bad json');
      return init.body ?? {};
    },
  } as unknown as Response;
}

const fetchMock = jest.fn();

describe('DepotCashHttpAdapter', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sums the window and sends the internal key, never a caller token', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { total: 1_250_000, count: 9 } }));

    const total = await new DepotCashHttpAdapter(makeConfig()).totalPaidCash('depot-1', FROM, TO);

    expect(total).toBe(1_250_000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://payment:3005/api/v1/payments/internal/depot-cash' +
        `?depotId=depot-1&from=${encodeURIComponent(FROM.toISOString())}&to=${encodeURIComponent(TO.toISOString())}`,
    );
    expect((init as { headers: Record<string, string> }).headers).toEqual({
      'x-internal-key': 'internal-key-01',
    });
  });

  it('accepts a depot that took nothing', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { total: 0, count: 0 } }));
    expect(await new DepotCashHttpAdapter(makeConfig()).totalPaidCash('depot-1', FROM, TO)).toBe(0);
  });

  it.each([
    ['payment-service unconfigured', { paymentServiceUrl: '' }],
    ['no internal key', { internalServiceKey: '' }],
  ])('throws rather than guess when %s', async (_label, over) => {
    await expect(
      new DepotCashHttpAdapter(makeConfig(over)).totalPaidCash('depot-1', FROM, TO),
    ).rejects.toBeInstanceOf(CashTotalUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new DepotCashHttpAdapter(makeConfig()).totalPaidCash('depot-1', FROM, TO),
    ).rejects.toBeInstanceOf(CashTotalUnavailableError);
  });

  it('throws when payment-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new DepotCashHttpAdapter(makeConfig()).totalPaidCash('depot-1', FROM, TO),
    ).rejects.toBeInstanceOf(CashTotalUnavailableError);
  });

  it.each([
    ['an unparseable body', { throwJson: true }],
    ['a missing total', { body: {} }],
    ['a non-numeric total', { body: { total: 'lots' } }],
    ['a negative total', { body: { total: -1 } }],
  ])('throws on %s', async (_label, init) => {
    fetchMock.mockResolvedValue(res({ ok: true, ...init }));
    await expect(
      new DepotCashHttpAdapter(makeConfig()).totalPaidCash('depot-1', FROM, TO),
    ).rejects.toBeInstanceOf(CashTotalUnavailableError);
  });
});
