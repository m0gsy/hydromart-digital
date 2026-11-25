import { StaffHrEmailHttpAdapter } from '../../src/infrastructure/http/staff-hr-email.http.adapter';

// The REAL adapter against a mocked global.fetch: hr-service's internal emails-by-accounts route.
const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const cfg = (over: { url?: string; key?: string } = {}) =>
  ({ peerUrl: () => over.url ?? 'http://hr.test', internalServiceKey: over.key ?? 'k' }) as never;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const sentIds = (call: number): string[] =>
  JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string).accountIds;

describe('StaffHrEmailHttpAdapter', () => {
  it('asks hr-service with the internal key, 200 ids a call, and keeps only usable rows', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    fetchMock
      .mockResolvedValueOnce(ok([{ accountId: 'id-0', email: ' a@hydromart.id ' }, { accountId: 'id-1', email: '  ' }, null, { accountId: 7, email: 'x' }]))
      .mockResolvedValueOnce(ok([{ accountId: 'id-200', email: 'b@hydromart.id' }]));
    await expect(new StaffHrEmailHttpAdapter(cfg()).emailsByAccounts(ids)).resolves.toEqual([
      { accountId: 'id-0', email: 'a@hydromart.id' },
      { accountId: 'id-200', email: 'b@hydromart.id' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hr.test/api/v1/employees/internal/emails-by-accounts');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k');
    expect(sentIds(0)).toHaveLength(200);
    expect(sentIds(1)).toEqual(['id-200']);
  });

  it('treats a non-array answer as no rows', async () => {
    fetchMock.mockResolvedValueOnce(ok({ nope: true }));
    await expect(new StaffHrEmailHttpAdapter(cfg()).emailsByAccounts(['x'])).resolves.toEqual([]);
  });

  it('throws when unconfigured or when hr-service refuses', async () => {
    await expect(new StaffHrEmailHttpAdapter(cfg({ url: '' })).emailsByAccounts(['x'])).rejects.toThrow('missing');
    await expect(new StaffHrEmailHttpAdapter(cfg({ key: '' })).emailsByAccounts(['x'])).rejects.toThrow('missing');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(new StaffHrEmailHttpAdapter(cfg()).emailsByAccounts(['x'])).rejects.toThrow('503');
  });
});
