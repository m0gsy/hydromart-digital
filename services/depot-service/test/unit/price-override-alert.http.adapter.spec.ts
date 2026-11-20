import { PriceOverrideAlertHttpAdapter } from '../../src/infrastructure/http/price-override-alert.http.adapter';
import { DepotConfigService } from '../../src/config/depot-config.service';

// Flow 6b: price changes proposed, posted for crm to send to the accounts that may decide them.
describe('PriceOverrideAlertHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (phone = '628111', url = 'http://crm') =>
    ({ alertPhone: phone, crmServiceUrl: url, internalServiceKey: 'k' }) as unknown as DepotConfigService;
  const alert = { depotId: 'd1', depotName: 'Depot A', count: 2, product: 'Galon, …' };

  it('posts PRICE_OVERRIDE_PROPOSED with the depot, so crm can find the deciders', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as never;
    await new PriceOverrideAlertHttpAdapter(config()).emit(alert);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://crm/api/v1/notifications/internal');
    expect(JSON.parse(init.body)).toEqual({
      event: 'PRICE_OVERRIDE_PROPOSED',
      phone: '628111',
      depotId: 'd1',
      vars: { depot: 'Depot A', count: '2', product: 'Galon, …' },
    });
  });

  it('skips when alerting is off, and never throws on a refusal or an outage', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    await new PriceOverrideAlertHttpAdapter(config('')).emit(alert);
    expect(fetchMock).not.toHaveBeenCalled();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(new PriceOverrideAlertHttpAdapter(config()).emit(alert)).resolves.toBeUndefined();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    await expect(new PriceOverrideAlertHttpAdapter(config()).emit(alert)).resolves.toBeUndefined();
  });
});
