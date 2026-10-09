import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { onDepotChanged } from '@/lib/depot-signal';

function respond(headers: Record<string, string> = {}) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  onDepotChanged(null);
});

describe('the "your depot changed" response header', () => {
  it('tells the registered listener which depot the server now says', async () => {
    const heard = vi.fn();
    onDepotChanged(heard);
    vi.stubGlobal('fetch', respond({ 'x-hm-depot-changed': 'depot-B' }));
    await api.get('/attendance/api/v1/attendance/me');
    expect(heard).toHaveBeenCalledWith('depot-B');
  });

  it('stays silent when the header is absent', async () => {
    const heard = vi.fn();
    onDepotChanged(heard);
    vi.stubGlobal('fetch', respond());
    await api.get('/attendance/api/v1/attendance/me');
    expect(heard).not.toHaveBeenCalled();
  });

  it('is harmless with nobody listening', async () => {
    vi.stubGlobal('fetch', respond({ 'x-hm-depot-changed': 'depot-B' }));
    await expect(api.get('/attendance/api/v1/attendance/me')).resolves.toEqual({ ok: true });
  });
});
