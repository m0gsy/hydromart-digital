import { CustomerContactHttpAdapter } from '../../src/infrastructure/http/customer-contact.http.adapter';
import { CustomerNotificationHttpAdapter } from '../../src/infrastructure/http/customer-notification.http.adapter';

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const config = (over: Record<string, string> = {}) =>
  ({
    customerServiceUrl: 'http://customer:3002',
    crmServiceUrl: 'http://crm:3012',
    internalServiceKey: 'internal-key',
    ...over,
  }) as never;

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const failed = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;

describe('CustomerContactHttpAdapter', () => {
  it('asks customer-service for ONE customer by id, over the internal key', async () => {
    fetchMock.mockResolvedValue(ok({ customerId: 'c1', name: 'Budi', phone: '+62811' }));
    await expect(new CustomerContactHttpAdapter(config()).resolve('c1')).resolves.toEqual({
      name: 'Budi',
      phone: '+62811',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/internal/contact/c1',
      expect.objectContaining({ headers: { 'x-internal-key': 'internal-key' } }),
    );
  });

  it('encodes the id into the path rather than trusting it', async () => {
    fetchMock.mockResolvedValue(ok(null));
    await new CustomerContactHttpAdapter(config()).resolve('a/../b');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://customer:3002/api/v1/profile/internal/contact/a%2F..%2Fb',
    );
  });

  it.each([
    ['no name', { phone: '+62811' }],
    ['no phone', { name: 'Budi' }],
    ['a null body', null],
  ])('answers null for a customer with %s — nothing to address a message to', async (_l, body) => {
    fetchMock.mockResolvedValue(ok(body));
    await expect(new CustomerContactHttpAdapter(config()).resolve('c1')).resolves.toBeNull();
  });

  it('answers null when customer-service refuses, without throwing', async () => {
    fetchMock.mockResolvedValue(failed(503));
    await expect(new CustomerContactHttpAdapter(config()).resolve('c1')).resolves.toBeNull();
  });

  it('answers null when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(new CustomerContactHttpAdapter(config()).resolve('c1')).resolves.toBeNull();
  });

  it.each([
    ['URL', { customerServiceUrl: '' }],
    ['key', { internalServiceKey: '' }],
  ])('does not call out at all when the %s is not configured', async (_l, over) => {
    await expect(new CustomerContactHttpAdapter(config(over)).resolve('c1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('CustomerNotificationHttpAdapter', () => {
  const vars = { name: 'Budi', depot: 'Cikini', gallons: '2', since: '12 Agu 2026' };

  it('posts the event to crm’s internal endpoint and says crm took it', async () => {
    fetchMock.mockResolvedValue(ok({}));
    const sent = await new CustomerNotificationHttpAdapter(config()).send(
      'GALLON_RETURN_REMINDER',
      '+62811',
      'c1',
      vars,
    );
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://crm:3012/api/v1/notifications/internal',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': 'internal-key' },
        body: JSON.stringify({
          event: 'GALLON_RETURN_REMINDER',
          phone: '+62811',
          customerId: 'c1',
          vars,
        }),
      }),
    );
  });

  // The whole reason this port returns a boolean: the sweep records "we asked" only on true.
  it('says NOT sent when crm refuses', async () => {
    fetchMock.mockResolvedValue(failed(400));
    await expect(
      new CustomerNotificationHttpAdapter(config()).send('GALLON_RETURN_REMINDER', '+62811', 'c1', vars),
    ).resolves.toBe(false);
  });

  it('says NOT sent when the request fails, without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(
      new CustomerNotificationHttpAdapter(config()).send('GALLON_RETURN_REMINDER', '+62811', 'c1', vars),
    ).resolves.toBe(false);
  });

  it.each([
    ['URL', { crmServiceUrl: '' }],
    ['key', { internalServiceKey: '' }],
  ])('says NOT sent, and does not call out, when the %s is not configured', async (_l, over) => {
    await expect(
      new CustomerNotificationHttpAdapter(config(over)).send('GALLON_RETURN_REMINDER', '+62811', 'c1', vars),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
