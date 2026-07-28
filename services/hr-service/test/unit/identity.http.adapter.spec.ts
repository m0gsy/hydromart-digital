import { ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../src/config/hr-config.service';
import { IdentityHttpAdapter } from '../../src/infrastructure/http/identity.http.adapter';

// Exercises the REAL adapter (URL build, x-internal-key header, !ok branch, network catch,
// missing-id guard) against a mocked global.fetch. Unlike the sales adapter this one fails
// HARD: an unprovisioned account must abort its import row, never pass silently.

function makeConfig(url = 'http://auth:3001/', internalKey = 'k-secret'): HrConfigService {
  return { authService: { url, internalKey } } as unknown as HrConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 201);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => init.body ?? {},
  } as unknown as Response;
}

const fetchMock = jest.fn();
const INPUT = { phone: '+628123456789', role: 'DRIVER' as const, fullName: 'Joko', depotId: 'd1' };

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('IdentityHttpAdapter.provisionStaff', () => {
  it('posts to the internal route with the shared key and returns the account id', async () => {
    fetchMock.mockResolvedValue(res({ body: { id: 'cust-1' } }));

    await expect(new IdentityHttpAdapter(makeConfig()).provisionStaff(INPUT)).resolves.toEqual({
      customerId: 'cust-1',
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth:3001/api/v1/auth/internal/staff');
    expect(options.method).toBe('POST');
    expect(options.headers['x-internal-key']).toBe('k-secret');
    expect(JSON.parse(options.body)).toEqual(INPUT);
  });

  it('throws without calling fetch when the url or key is unset', async () => {
    await expect(
      new IdentityHttpAdapter(makeConfig('', 'k')).provisionStaff(INPUT),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      new IdentityHttpAdapter(makeConfig('http://auth:3001', '')).provisionStaff(INPUT),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx response, carrying the status', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 409 }));
    await expect(new IdentityHttpAdapter(makeConfig()).provisionStaff(INPUT)).rejects.toThrow(
      /409/,
    );
  });

  it('throws when the network call itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new IdentityHttpAdapter(makeConfig()).provisionStaff(INPUT)).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it('throws on a non-Error network rejection too', async () => {
    fetchMock.mockRejectedValue('boom');
    await expect(new IdentityHttpAdapter(makeConfig()).provisionStaff(INPUT)).rejects.toThrow(
      /unknown/,
    );
  });

  it('throws when the response carries no account id', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    await expect(new IdentityHttpAdapter(makeConfig()).provisionStaff(INPUT)).rejects.toThrow(
      /tidak mengembalikan id/,
    );
  });
});
