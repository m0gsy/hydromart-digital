import { AccountNamesHttpAdapter } from '../../src/infrastructure/http/account-names.http.adapter';
import { OrderConfigService } from '../../src/config/order-config.service';

// Owner decision 2026-11-20: "Dikoreksi oleh X" — the corrector's name, fail-soft.
describe('AccountNamesHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (base = 'http://auth:3001') =>
    ({ authServiceUrl: base, internalServiceKey: 'k' }) as unknown as OrderConfigService;

  it("asks auth for the account's profile and answers its name", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'a-1', fullName: 'Budi' }] });
    global.fetch = fetchMock as never;
    expect(await new AccountNamesHttpAdapter(config()).nameOf('a-1')).toBe('Budi');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth:3001/api/v1/auth/internal/customers/by-ids');
    expect(JSON.parse(init.body)).toEqual({ ids: ['a-1'] });
  });

  it('answers null — never throws — when it cannot tell', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'other', fullName: 'X' }] }) as never;
    expect(await new AccountNamesHttpAdapter(config()).nameOf('a-1')).toBeNull();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'a-1', fullName: '  ' }] }) as never;
    expect(await new AccountNamesHttpAdapter(config()).nameOf('a-1')).toBeNull();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ not: 'a list' }) }) as never;
    expect(await new AccountNamesHttpAdapter(config()).nameOf('a-1')).toBeNull();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    expect(await new AccountNamesHttpAdapter(config()).nameOf('a-1')).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    expect(await new AccountNamesHttpAdapter(config()).nameOf('a-1')).toBeNull();
    const unconfigured = jest.fn();
    global.fetch = unconfigured as never;
    expect(await new AccountNamesHttpAdapter(config('')).nameOf('a-1')).toBeNull();
    expect(unconfigured).not.toHaveBeenCalled();
  });
});
