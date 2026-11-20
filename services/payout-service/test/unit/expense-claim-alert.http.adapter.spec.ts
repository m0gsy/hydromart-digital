import { ExpenseClaimAlertHttpAdapter } from '../../src/infrastructure/http/expense-claim-alert.http.adapter';
import { ConfigService } from '@nestjs/config';

import { PayoutConfigService } from '../../src/config/payout-config.service';

// Flow 6b: a waiting claim, posted for crm to send to the accounts that may decide it.
describe('ExpenseClaimAlertHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (phone = '628111') =>
    ({ crmServiceUrl: 'http://crm', internalServiceKey: 'k', opsAlertPhone: phone }) as unknown as PayoutConfigService;
  const alert = { claimId: 'cl-1', depotId: 'dep-1', amount: 90000, category: 'FUEL' };

  it('posts EXPENSE_CLAIM_SUBMITTED with the depot and the amount as copy', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as never;
    await new ExpenseClaimAlertHttpAdapter(config()).submitted(alert);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://crm/api/v1/notifications/internal');
    expect(JSON.parse(init.body)).toEqual({
      event: 'EXPENSE_CLAIM_SUBMITTED',
      phone: '628111',
      depotId: 'dep-1',
      // The reviewer reads words, not the enum.
      vars: { claimId: 'cl-1', amount: 'Rp 90.000', category: 'BBM' },
    });
    await new ExpenseClaimAlertHttpAdapter(config()).submitted({ ...alert, depotId: null, category: 'NEW_KIND' });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second).not.toHaveProperty('depotId');
    expect(second.vars.category).toBe('new_kind');
  });

  it('skips when alerting is off, and never throws on a refusal or an outage', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    await new ExpenseClaimAlertHttpAdapter(config('')).submitted(alert);
    expect(fetchMock).not.toHaveBeenCalled();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(new ExpenseClaimAlertHttpAdapter(config()).submitted(alert)).resolves.toBeUndefined();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    await expect(new ExpenseClaimAlertHttpAdapter(config()).submitted(alert)).resolves.toBeUndefined();
  });
});

// Flow 6b: the config the alert reads.
describe('PayoutConfigService · crm alert config', () => {
  it('reads the crm URL without a trailing slash, and the ops phone', () => {
    const config = new PayoutConfigService(
      new ConfigService({ CRM_SERVICE_URL: 'http://crm:3012/', OPS_ALERT_PHONE: '628111' }),
      {} as never,
    );
    expect(config.crmServiceUrl).toBe('http://crm:3012');
    expect(config.opsAlertPhone).toBe('628111');
  });
});
