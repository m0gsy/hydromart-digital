import { PaymentConfigService } from '../../src/config/payment-config.service';
import { PaymentGatewayHttpAdapter } from '../../src/infrastructure/http/payment-gateway.http.adapter';
import { OrderCoordinationHttpAdapter } from '../../src/infrastructure/http/order-coordination.http.adapter';
import type { ChargeRequest } from '../../src/application/ports/payment-gateway.port';

// These specs exercise the REAL HTTP adapter code (URL building, headers, res.ok
// branches, fail-open/fail-closed handling, response parsing) against a mocked
// global.fetch — the units the e2e's Fake* stand-ins never run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): PaymentConfigService {
  return {
    gatewayBaseUrl: 'http://gateway:9000',
    gatewayApiKey: 'gw-secret',
    orderServiceUrl: 'http://order:3002',
    internalServiceKey: KEY,
    ...over,
  } as unknown as PaymentConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => init.body ?? {},
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const charge = (): ChargeRequest =>
  ({
    method: 'VA_BCA',
    amount: 57000,
    orderId: 'o1',
    paymentId: 'pay1',
  }) as unknown as ChargeRequest;

describe('PaymentGatewayHttpAdapter', () => {
  it('createCharge: posts to /charges and parses reference + instruction', async () => {
    fetchMock.mockResolvedValue(res({ body: { reference: 'REF-1', instruction: 'Pay at BCA' } }));
    const out = await new PaymentGatewayHttpAdapter(makeConfig()).createCharge(charge());
    expect(out.reference).toBe('REF-1');
    expect(out.instruction).toBe('Pay at BCA');
    expect(out.raw).toBe(JSON.stringify({ reference: 'REF-1', instruction: 'Pay at BCA' }));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gateway:9000/charges',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer gw-secret' }),
      }),
    );
  });

  it('createCharge: falls back to default instruction when gateway omits it', async () => {
    fetchMock.mockResolvedValue(res({ body: { reference: 'REF-2' } }));
    const out = await new PaymentGatewayHttpAdapter(makeConfig()).createCharge(charge());
    expect(out.instruction).toBe('Complete the payment using the reference provided.');
  });

  it('refund: posts to /refunds and parses reference', async () => {
    fetchMock.mockResolvedValue(res({ body: { reference: 'RF-1' } }));
    const out = await new PaymentGatewayHttpAdapter(makeConfig()).refund('REF-1', 5000);
    expect(out.reference).toBe('RF-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gateway:9000/refunds',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails CLOSED (throws) when no gateway base url is configured', async () => {
    const a = new PaymentGatewayHttpAdapter(makeConfig({ gatewayBaseUrl: '' }));
    await expect(a.createCharge(charge())).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED (throws) on non-2xx gateway response', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 502 }));
    await expect(
      new PaymentGatewayHttpAdapter(makeConfig()).createCharge(charge()),
    ).rejects.toThrow(/502/);
  });

  it('fails CLOSED (rethrows) when the gateway is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new PaymentGatewayHttpAdapter(makeConfig()).refund('REF', 1)).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});

describe('OrderCoordinationHttpAdapter', () => {
  describe('getOrderTotal', () => {
    it('returns null (skips) when coordination is disabled', async () => {
      const a = new OrderCoordinationHttpAdapter(makeConfig({ internalServiceKey: '' }));
      expect(await a.getOrderTotal('o1')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches and returns the total on happy path', async () => {
      fetchMock.mockResolvedValue(res({ body: { total: 57000 } }));
      const out = await new OrderCoordinationHttpAdapter(makeConfig()).getOrderTotal('o1');
      expect(out).toBe(57000);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://order:3002/api/v1/orders/o1/internal-total',
        expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-key': KEY }) }),
      );
    });

    it('fails CLOSED (throws) on non-2xx', async () => {
      fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
      await expect(
        new OrderCoordinationHttpAdapter(makeConfig()).getOrderTotal('o1'),
      ).rejects.toThrow(/500/);
    });

    it('fails CLOSED (throws) when the total is missing/non-numeric', async () => {
      fetchMock.mockResolvedValue(res({ body: { total: 'oops' } }));
      await expect(
        new OrderCoordinationHttpAdapter(makeConfig()).getOrderTotal('o1'),
      ).rejects.toThrow(/no total/);
    });
  });

  describe('confirmPaid / notifyRefunded (fail-open POST)', () => {
    it('confirmPaid: skips without key + posts on happy path', async () => {
      await new OrderCoordinationHttpAdapter(makeConfig({ orderServiceUrl: '' })).confirmPaid('o1');
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockResolvedValue(res({ ok: true }));
      await new OrderCoordinationHttpAdapter(makeConfig()).confirmPaid('o1');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://order:3002/api/v1/orders/o1/internal-confirm',
        expect.objectContaining({ method: 'POST', body: undefined }),
      );
    });

    it('confirmPaid: fails OPEN (swallows) on non-2xx and on thrown fetch', async () => {
      fetchMock.mockResolvedValueOnce(res({ ok: false, status: 503 }));
      await expect(
        new OrderCoordinationHttpAdapter(makeConfig()).confirmPaid('o1'),
      ).resolves.toBeUndefined();
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(
        new OrderCoordinationHttpAdapter(makeConfig()).confirmPaid('o1'),
      ).resolves.toBeUndefined();
    });

    it('notifyRefunded: posts amount body on happy path', async () => {
      fetchMock.mockResolvedValue(res({ ok: true }));
      await new OrderCoordinationHttpAdapter(makeConfig()).notifyRefunded('o1', 5000);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://order:3002/api/v1/orders/o1/internal-refund',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ amount: 5000 }) }),
      );
    });
  });
});

// §G-3. A payment row holds only the order id, so the refund queue asked HQ to approve
// money against eight hex characters. This reads the numbers back from order-service.
describe('OrderCoordinationHttpAdapter.getOrderNumbers', () => {
  it('posts the unique ids and maps them to their numbers', async () => {
    fetchMock.mockResolvedValue(
      res({ body: [{ orderId: 'o1', orderNumber: 'HM-1' }, { orderId: 'o2' }] }),
    );

    const out = await new OrderCoordinationHttpAdapter(makeConfig()).getOrderNumbers([
      'o1',
      'o1',
      'o2',
      '',
    ]);

    expect([...out]).toEqual([['o1', 'HM-1']]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://order:3002/api/v1/orders/internal/values');
    expect(JSON.parse(init.body)).toEqual({ orderIds: ['o1', 'o2'] });
    expect(init.headers['x-internal-key']).toBe(KEY);
  });

  it('asks nothing when unconfigured or given no ids', async () => {
    expect((await new OrderCoordinationHttpAdapter(makeConfig()).getOrderNumbers([])).size).toBe(0);
    expect(
      (
        await new OrderCoordinationHttpAdapter(makeConfig({ orderServiceUrl: '' })).getOrderNumbers([
          'o1',
        ])
      ).size,
    ).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Fails SOFT, unlike getOrderTotal: this decorates a queue, it does not price anything.
  // A refund decision must never be blocked because a number could not be read.
  it('degrades to no numbers on a refusal or an outage', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    expect((await new OrderCoordinationHttpAdapter(makeConfig()).getOrderNumbers(['o1'])).size).toBe(
      0,
    );

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await new OrderCoordinationHttpAdapter(makeConfig()).getOrderNumbers(['o1'])).size).toBe(
      0,
    );
  });
});

// The abort timer this adapter arms had never been let fire for the new call: a hung
// order-service must still let the refund queue answer.
describe('OrderCoordinationHttpAdapter.getOrderNumbers when order-service hangs', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const aborted = new Error('The operation was aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        }),
    );
  });
  afterEach(() => jest.useRealTimers());

  it('aborts and answers with no numbers', async () => {
    // The handler has to be attached before the timer fires, or the rejection lands unhandled.
    const settled = new OrderCoordinationHttpAdapter(makeConfig()).getOrderNumbers(['o1']);
    await jest.advanceTimersByTimeAsync(10_000);
    expect((await settled).size).toBe(0);
  });
});
