import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../src/config/hr-config.service';
import { IdentityHttpAdapter } from '../../src/infrastructure/http/identity.http.adapter';
import { UnusedCustomerOnPhoneError } from '../../src/application/ports/identity.port';

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
const INPUT = {
  phone: '+628123456789',
  role: 'STAFF_DEPOT' as const,
  fullName: 'Joko',
  depotId: 'd1',
};

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

// The other three writes hr-service makes against the account. Each has its own route,
// and posting to the wrong one silently does nothing to the login — the URL IS the test.
describe('IdentityHttpAdapter, the rest of the account writes', () => {
  it('sends the managed-staff form to the wider allowlist route', async () => {
    fetchMock.mockResolvedValue(res({ body: { id: 'cust-2' } }));

    await expect(
      new IdentityHttpAdapter(makeConfig()).provisionManagedStaff({
        ...INPUT,
        superiorId: 'boss-1',
      } as never),
    ).resolves.toEqual({ customerId: 'cust-2' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://auth:3001/api/v1/auth/internal/staff/managed');
  });

  it('reports a jabatan change to the role route', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    const input = { customerId: 'c1', role: 'MANAGER' as const, depotId: 'd1' };

    await new IdentityHttpAdapter(makeConfig()).assignRole(input);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth:3001/api/v1/auth/internal/staff/role');
    expect(JSON.parse(options.body)).toEqual(input);
  });

  it('reports a corrected name and phone to the profile route', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    const input = { customerId: 'c1', fullName: 'Budi Santoso', phone: '08129999' };

    await new IdentityHttpAdapter(makeConfig()).updateStaffProfile(input);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth:3001/api/v1/auth/internal/staff/profile');
    expect(JSON.parse(options.body)).toEqual(input);
  });

  // A 409 here is DATA, not an outage: that number belongs to someone else. "auth-service
  // menolak (409)" told the person editing to try again later, which would never work.
  it('turns a taken number into a sentence instead of a 503', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 409 }));

    await expect(
      new IdentityHttpAdapter(makeConfig()).updateStaffProfile({ customerId: 'c1', phone: '0812' }),
    ).rejects.toThrow(/sudah dipakai akun lain/);

    // A 409 whose body cannot be read is still a taken number, not an outage.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    } as unknown as Response);
    await expect(
      new IdentityHttpAdapter(makeConfig()).updateStaffProfile({ customerId: 'c1', phone: '0812' }),
    ).rejects.toThrow(/sudah dipakai akun lain/);
  });

  // Owner decision 2026-11-20: a never-used customer account on the number is closed only once
  // HR confirms, so the refusal has to name it — HR tells their employee from a typo by it.
  it('names a never-used customer account on the number, for HR to confirm closing it', async () => {
    const adapter = new IdentityHttpAdapter(makeConfig());
    fetchMock.mockResolvedValue(
      res({
        ok: false,
        status: 409,
        body: {
          code: 'AUTH_PHONE_UNUSED_CUSTOMER',
          details: { customerName: 'Khoirul', createdAt: '2026-11-18T05:00:00.000Z' },
        },
      }),
    );
    const refused = adapter.updateStaffProfile({ customerId: 'c1', phone: '0812' });
    await expect(refused).rejects.toBeInstanceOf(UnusedCustomerOnPhoneError);
    await expect(refused).rejects.toMatchObject({ code: 'HR_PHONE_UNUSED_CUSTOMER', status: 409 });
    await expect(refused).rejects.toThrow(/atas nama Khoirul \(dibuat 18 November 2026\)/);

    fetchMock.mockResolvedValue(
      res({ ok: false, status: 409, body: { code: 'AUTH_PHONE_UNUSED_CUSTOMER', details: {} } }),
    );
    await expect(adapter.updateStaffProfile({ customerId: 'c1', phone: '0812' })).rejects.toThrow(
      /akun pelanggan tanpa nama yang belum pernah dipakai/,
    );
    fetchMock.mockResolvedValue(
      res({
        ok: false,
        status: 409,
        body: { code: 'AUTH_PHONE_UNUSED_CUSTOMER', details: { createdAt: 'not a date' } },
      }),
    );
    await expect(adapter.updateStaffProfile({ customerId: 'c1', phone: '0812' })).rejects.toThrow(
      /tanpa nama yang belum/,
    );
  });

  it("carries HR's confirmation to auth-service", async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    await new IdentityHttpAdapter(makeConfig()).updateStaffProfile({
      customerId: 'c1',
      phone: '0812',
      closeUnusedCustomer: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      closeUnusedCustomer: true,
    });
  });

  it('reports a resignation to the status route', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));

    await new IdentityHttpAdapter(makeConfig()).setStaffActive('c1', false);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth:3001/api/v1/auth/internal/staff/status');
    expect(JSON.parse(options.body)).toEqual({ customerId: 'c1', active: false });
  });

  // auth-service says WHY it refused. Collapsing that to "(403)" left the person at the form
  // with nothing to fix; the reason has to reach them.
  it('surfaces the reason auth-service gives for a 4xx refusal', async () => {
    fetchMock.mockResolvedValue(
      res({ ok: false, status: 403, body: { message: 'Peran ini tidak boleh diberikan' } }),
    );
    const call = new IdentityHttpAdapter(makeConfig()).assignRole({
      customerId: 'c1',
      role: 'MANAGER' as never,
      depotId: null,
    });
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow(/Peran ini tidak boleh diberikan/);
  });

  it('joins a validation-array message, and keeps a 401 an outage even with a body', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ ok: false, status: 400, body: { message: ['a salah', 'b salah'] } }),
    );
    await expect(new IdentityHttpAdapter(makeConfig()).setStaffActive('c1', false)).rejects.toThrow(
      'a salah; b salah',
    );
    fetchMock.mockResolvedValueOnce(
      res({ ok: false, status: 401, body: { message: 'Invalid key' } }),
    );
    await expect(
      new IdentityHttpAdapter(makeConfig()).setStaffActive('c1', false),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('falls back to the status when the body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error('x');
      },
    } as never);
    await expect(new IdentityHttpAdapter(makeConfig()).setStaffActive('c1', false)).rejects.toThrow(
      /400/,
    );
  });

  // Same hard-fail contract as provisionStaff: hr-service must not report a role change
  // as done when the login never heard about it.
  it('fails hard when auth-service refuses a role change', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 403 }));
    await expect(
      new IdentityHttpAdapter(makeConfig()).assignRole({
        customerId: 'c1',
        role: 'MANAGER' as never,
        depotId: null,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
