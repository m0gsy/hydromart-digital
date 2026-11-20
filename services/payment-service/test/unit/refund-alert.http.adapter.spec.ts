import { RefundAlertHttpAdapter } from '../../src/infrastructure/http/refund-alert.http.adapter';
import { PaymentConfigService } from '../../src/config/payment-config.service';
import { buildTestConfig } from '../support/fakes';

// Flow 6b: a refund waiting in the HQ queue, posted for crm to send to the accounts that decide it.
describe('RefundAlertHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (phone = '628111') =>
    ({ crmServiceUrl: 'http://crm', internalServiceKey: 'k', opsAlertPhone: phone }) as unknown as PaymentConfigService;
  const alert = { paymentId: 'p-1', depotId: null, amount: 150000 };

  it('posts REFUND_REQUESTED with the amount as copy, and the depot only when there is one', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as never;
    await new RefundAlertHttpAdapter(config()).requested(alert);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      event: 'REFUND_REQUESTED',
      phone: '628111',
      vars: { paymentId: 'p-1', amount: 'Rp 150.000' },
    });
    await new RefundAlertHttpAdapter(config()).requested({ ...alert, depotId: 'dep-1' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).depotId).toBe('dep-1');
  });

  it('skips when alerting is off, and never throws on a refusal or an outage', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    await new RefundAlertHttpAdapter(config('')).requested(alert);
    expect(fetchMock).not.toHaveBeenCalled();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(new RefundAlertHttpAdapter(config()).requested(alert)).resolves.toBeUndefined();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    await expect(new RefundAlertHttpAdapter(config()).requested(alert)).resolves.toBeUndefined();
  });
});

// Flow 6b: the config the alert reads.
describe('PaymentConfigService · crm alert config', () => {
  it('reads the crm URL without a trailing slash, and the ops phone', () => {
    const config = buildTestConfig({ CRM_SERVICE_URL: 'http://crm:3012/', OPS_ALERT_PHONE: '628111' });
    expect(config.crmServiceUrl).toBe('http://crm:3012');
    expect(config.opsAlertPhone).toBe('628111');
  });
});
