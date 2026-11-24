import { StaffDirectoryHttpAdapter } from '../../src/infrastructure/http/staff-directory.http.adapter';

// The REAL adapter against a mocked global.fetch: auth-service's internal by-ids route.
const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const cfg = (over: Record<string, unknown> = {}) =>
  ({ authServiceUrl: 'http://auth.test', internalServiceKey: 'k', ...over }) as never;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const sentIds = (call: number): string[] =>
  JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string).ids;

describe('StaffDirectoryHttpAdapter', () => {
  it('reads the logins by id with the internal key, 200 ids a call', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    fetchMock
      .mockResolvedValueOnce(
        ok([{ id: 'id-0', email: 'a@hydromart.id', role: 'HEAD_OFFICE', status: 'ACTIVE', phone: '+62811' }]),
      )
      .mockResolvedValueOnce(ok([{ id: 'id-200', email: null, role: 'DIREKTUR', status: 'ACTIVE' }]));
    await expect(new StaffDirectoryHttpAdapter(cfg()).accountsByIds(ids)).resolves.toEqual([
      { id: 'id-0', email: 'a@hydromart.id', role: 'HEAD_OFFICE', status: 'ACTIVE' },
      { id: 'id-200', email: null, role: 'DIREKTUR', status: 'ACTIVE' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://auth.test/api/v1/auth/internal/customers/by-ids');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-internal-key': 'k' });
    expect(sentIds(0)).toHaveLength(200);
    expect(sentIds(1)).toEqual(['id-200']);
  });

  it('keeps only whole rows, and reads an email that is not a string as none', async () => {
    fetchMock.mockResolvedValueOnce(
      ok([
        null,
        { id: 7 },
        { id: 'x', role: 'HEAD_OFFICE' },
        { id: 'y', role: 'HEAD_OFFICE', status: 'ACTIVE', email: 5 },
      ]),
    );
    await expect(new StaffDirectoryHttpAdapter(cfg()).accountsByIds(['x', 'y'])).resolves.toEqual([
      { id: 'y', role: 'HEAD_OFFICE', status: 'ACTIVE', email: null },
    ]);
    fetchMock.mockResolvedValueOnce(ok({ not: 'a list' }));
    await expect(new StaffDirectoryHttpAdapter(cfg()).accountsByIds(['x'])).resolves.toEqual([]);
  });

  it('throws when it cannot ask, and when auth-service refuses', async () => {
    await expect(new StaffDirectoryHttpAdapter(cfg({ authServiceUrl: '' })).accountsByIds(['x'])).rejects.toThrow(
      'missing',
    );
    await expect(
      new StaffDirectoryHttpAdapter(cfg({ internalServiceKey: '' })).accountsByIds(['x']),
    ).rejects.toThrow('missing');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response);
    await expect(new StaffDirectoryHttpAdapter(cfg()).accountsByIds(['x'])).rejects.toThrow('503');
  });
});
