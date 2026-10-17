import { TaxRateHttpAdapter } from '../../src/infrastructure/http/tax-rate.http.adapter';
import { OrderConfigService } from '../../src/config/order-config.service';

function config(over: Partial<Record<string, string>> = {}): OrderConfigService {
  return {
    internalServiceKey: 'k'.repeat(32),
    paymentServiceUrl: 'http://payment:3005',
    ...over,
  } as unknown as OrderConfigService;
}

const res = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('TaxRateHttpAdapter (FR-034)', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.useFakeTimers({
      now: new Date('2026-09-01T00:00:00Z'),
      doNotFake: ['nextTick', 'setImmediate'],
    });
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('reads the rate from the internal route with the service key', async () => {
    fetchMock.mockResolvedValue(res({ ppnPercent: 11, taxRounding: 'HALF_UP' }));
    const out = await new TaxRateHttpAdapter(config()).current();
    expect(out).toEqual({ percent: 11, rounding: 'HALF_UP' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://payment:3005/api/v1/tax-settings/internal/rate',
    );
    expect(fetchMock.mock.calls[0][1].headers['x-internal-key']).toBe('k'.repeat(32));
  });

  it('asks once, then answers from memory for five minutes', async () => {
    fetchMock.mockResolvedValue(res({ ppnPercent: 11, taxRounding: 'HALF_UP' }));
    const adapter = new TaxRateHttpAdapter(config());
    await adapter.current();
    jest.setSystemTime(new Date('2026-09-01T00:04:00Z'));
    await adapter.current();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-09-01T00:06:00Z'));
    fetchMock.mockResolvedValue(res({ ppnPercent: 12, taxRounding: 'DOWN' }));
    expect(await adapter.current()).toEqual({ percent: 12, rounding: 'DOWN' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps using the last rate when a refresh fails, rather than dropping the tax', async () => {
    fetchMock.mockResolvedValueOnce(res({ ppnPercent: 11, taxRounding: 'HALF_UP' }));
    const adapter = new TaxRateHttpAdapter(config());
    await adapter.current();
    jest.setSystemTime(new Date('2026-09-01T00:10:00Z'));
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await adapter.current()).toEqual({ percent: 11, rounding: 'HALF_UP' });
  });

  it('answers null, never throws, when nothing has ever been read', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new TaxRateHttpAdapter(config()).current()).toBeNull();
    fetchMock.mockResolvedValue(res({}, 503));
    expect(await new TaxRateHttpAdapter(config()).current()).toBeNull();
  });

  it('refuses a payload it cannot trust', async () => {
    const adapter = new TaxRateHttpAdapter(config());
    fetchMock.mockResolvedValue(res({ ppnPercent: 'eleven', taxRounding: 'HALF_UP' }));
    expect(await adapter.current()).toBeNull();
    fetchMock.mockResolvedValue(res({ ppnPercent: -1, taxRounding: 'HALF_UP' }));
    expect(await adapter.current()).toBeNull();
    fetchMock.mockResolvedValue(res({ ppnPercent: 11, taxRounding: 'BANKERS' }));
    expect(await adapter.current()).toBeNull();
  });

  it('does not call out without a service key or a payment-service address', async () => {
    expect(await new TaxRateHttpAdapter(config({ internalServiceKey: '' })).current()).toBeNull();
    expect(await new TaxRateHttpAdapter(config({ paymentServiceUrl: '' })).current()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
