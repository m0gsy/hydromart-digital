import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
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
});
