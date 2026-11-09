// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * FLW-024. Two tabs of the ops console share localStorage but each held its own copy of the
 * session and of the selected depot, read once. Signing out in tab A left tab B showing (and
 * sending requests as) the person who had left; changing depot in A left B scoped to the old one.
 * The browser tells every OTHER tab about a storage write, so the stores listen for it.
 */
const store = async () => {
  vi.resetModules();
  const session = await import('@/lib/session-store');
  const depot = await import('@/lib/depot-store');
  return { session, depot };
};

const fromOtherTab = (key: string | null, newValue: string | null) =>
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

describe('FLW-024 cross-tab session and depot sync', () => {
  beforeEach(() => window.localStorage.clear());

  it('signs this tab out when another tab signs out', async () => {
    window.localStorage.setItem('hm.session', JSON.stringify({ customer: { id: 'u1' } }));
    const { session } = await store();
    const seen = vi.fn();
    session.subscribe(seen);
    expect(session.getSession()?.customer.id).toBe('u1');

    window.localStorage.removeItem('hm.session');
    fromOtherTab('hm.session', null);

    expect(session.getSession()).toBeNull();
    expect(seen).toHaveBeenCalledWith(null);
  });

  it('follows another tab signing in as someone else', async () => {
    const { session } = await store();
    session.getSession();
    window.localStorage.setItem('hm.session', JSON.stringify({ customer: { id: 'u2' } }));
    fromOtherTab('hm.session', JSON.stringify({ customer: { id: 'u2' } }));
    expect(session.getSession()?.customer.id).toBe('u2');
  });

  it('treats localStorage.clear() in another tab (key null) as a sign-out', async () => {
    window.localStorage.setItem('hm.session', JSON.stringify({ customer: { id: 'u1' } }));
    const { session } = await store();
    session.getSession();
    window.localStorage.clear();
    fromOtherTab(null, null);
    expect(session.getSession()).toBeNull();
  });

  it('does not notify when the other tab wrote what this tab already holds', async () => {
    window.localStorage.setItem('hm.session', JSON.stringify({ customer: { id: 'u1' } }));
    const { session } = await store();
    session.getSession();
    const seen = vi.fn();
    session.subscribe(seen);
    fromOtherTab('hm.session', window.localStorage.getItem('hm.session'));
    expect(seen).not.toHaveBeenCalled();
  });

  it('survives a corrupt value written by another tab', async () => {
    window.localStorage.setItem('hm.session', JSON.stringify({ customer: { id: 'u1' } }));
    const { session } = await store();
    session.getSession();
    window.localStorage.setItem('hm.session', '{not json');
    fromOtherTab('hm.session', '{not json');
    expect(session.getSession()).toBeNull();
  });

  it('follows a depot change made in another tab', async () => {
    window.localStorage.setItem('hm.depot', 'd1');
    const { depot } = await store();
    const seen = vi.fn();
    depot.subscribe(seen);
    expect(depot.getDepot()).toBe('d1');

    window.localStorage.setItem('hm.depot', 'd2');
    fromOtherTab('hm.depot', 'd2');
    expect(depot.getDepot()).toBe('d2');
    expect(seen).toHaveBeenCalledWith('d2');

    window.localStorage.removeItem('hm.depot');
    fromOtherTab('hm.depot', null);
    expect(depot.getDepot()).toBeNull();
  });

  it('ignores storage events for unrelated keys', async () => {
    window.localStorage.setItem('hm.depot', 'd1');
    const { depot } = await store();
    depot.getDepot();
    const seen = vi.fn();
    depot.subscribe(seen);
    fromOtherTab('something.else', 'x');
    expect(seen).not.toHaveBeenCalled();
  });
});
