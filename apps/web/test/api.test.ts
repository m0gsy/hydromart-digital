import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url?: string, _init?: RequestInit) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('flattens a NestJS validation error array into one message', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { message: ['phone must not be empty', 'code too short'] }));
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 400,
      message: 'phone must not be empty, code too short',
    } satisfies Partial<ApiError>);
  });

  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal('fetch', mockFetch(204, null));
    await expect(api.del('/orders/api/v1/cart')).resolves.toBeUndefined();
  });

  it('maps a network failure to a status-0 ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('failed to fetch');
    }));
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/x')).rejects.toHaveProperty('status', 0);
  });

  // DELETE overload (settings reset needs a JSON body; every other caller passes
  // just `auth` — both call shapes must keep working through the same function).
  it('del(path, true) sends no body (existing callers)', async () => {
    const fetchMock = mockFetch(204, null);
    vi.stubGlobal('fetch', fetchMock);
    await api.del('/x', true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'DELETE', body: undefined });
  });

  it('del(path, body, true) sends the body as JSON', async () => {
    const fetchMock = mockFetch(204, null);
    vi.stubGlobal('fetch', fetchMock);
    await api.del('/x', { scope: 'GLOBAL', key: 'k' }, true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'DELETE', body: JSON.stringify({ scope: 'GLOBAL', key: 'k' }) });
  });
});
