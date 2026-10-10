// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A phone left open must follow its account to another depot. The provider used to read
 * `/auth/me` once, at mount, and never again.
 */

const h = vi.hoisted(() => ({
  me: { id: 'u1', role: 'STAFF_DEPOT', assignedDepotId: 'depot-A' } as Record<string, unknown>,
  get: vi.fn(),
  refreshNow: vi.fn(async () => null),
  handler: null as null | ((d: string) => void),
  session: { customer: { id: 'u1', role: 'STAFF_DEPOT', assignedDepotId: 'depot-A' } } as { customer: Record<string, unknown> } | null,
  setSession: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get: h.get, post: vi.fn(async () => undefined) },
}));
vi.mock('@/lib/depot-signal', () => ({
  refreshNow: h.refreshNow,
  onDepotChanged: (fn: ((d: string) => void) | null) => {
    h.handler = fn;
  },
}));
vi.mock('@/lib/endpoints', () => ({ endpoints: { auth: { me: '/auth/me', logout: '/auth/logout' } } }));
vi.mock('@/lib/push', () => ({ unsubscribeFromPush: async () => undefined }));
vi.mock('@/lib/unread', () => ({ forgetNotificationsSeen: () => undefined }));
vi.mock('@/lib/location-store', () => ({ setLocation: () => undefined }));
vi.mock('@/lib/session-device', () => ({ forgetSessionFamily: () => undefined, rememberSessionFamily: () => undefined }));
vi.mock('@/lib/token-store', () => ({
  clearTokens: () => undefined,
  getRefreshToken: () => null,
  hasTokens: () => true,
  unlockTokens: async () => undefined,
}));
vi.mock('@/lib/session-store', () => ({
  getSession: () => h.session,
  setSession: (s: unknown) => {
    h.setSession(s);
    h.session = s as typeof h.session;
  },
  subscribe: () => () => undefined,
}));

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { getDepot, setDepot } from '@/lib/depot-store';

function Probe({ onAuth }: { onAuth?: (a: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onAuth?.(auth);
  return null;
}

function show(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('AuthProvider keeps the account and the depot selection honest', () => {
  beforeEach(() => {
    h.get.mockReset();
    h.refreshNow.mockClear();
    h.setSession.mockClear();
    h.handler = null;
    h.session = { customer: { id: 'u1', role: 'STAFF_DEPOT', assignedDepotId: 'depot-A' } };
    window.localStorage.clear();
    setDepot('depot-A');
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T01:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
    setDepot(null);
  });

  it('re-asks the server when the app returns to the foreground, and follows a depot change', async () => {
    h.get.mockResolvedValue({ id: 'u1', role: 'STAFF_DEPOT', assignedDepotId: 'depot-A' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1)); // the mount check

    // A minute later the person is at another depot, and opens the app again.
    vi.setSystemTime(new Date('2026-10-26T01:02:00.000Z'));
    h.get.mockResolvedValue({ id: 'u1', role: 'STAFF_DEPOT', assignedDepotId: 'depot-B' });
    await act(async () => show('visible'));

    await waitFor(() => expect(getDepot()).toBe('depot-B'));
    expect(h.refreshNow).toHaveBeenCalledTimes(1); // the token follows, not only the screens
  });

  it('does not hammer the server: a second focus within a minute is ignored', async () => {
    h.get.mockResolvedValue({ id: 'u1', assignedDepotId: 'depot-A' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    vi.setSystemTime(new Date('2026-10-26T01:02:00.000Z'));
    await act(async () => show('visible'));
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    vi.setSystemTime(new Date('2026-10-26T01:02:20.000Z'));
    await act(async () => show('visible'));
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it('ignores the app going to the background', async () => {
    h.get.mockResolvedValue({ id: 'u1', assignedDepotId: 'depot-A' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    vi.setSystemTime(new Date('2026-10-26T01:05:00.000Z'));
    await act(async () => show('hidden'));
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('a server hint ("your depot changed") re-checks at once, even inside the minute', async () => {
    h.get.mockResolvedValue({ id: 'u1', assignedDepotId: 'depot-A' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    expect(h.handler).toBeTypeOf('function');
    h.get.mockResolvedValue({ id: 'u1', assignedDepotId: 'depot-C' });
    await act(async () => h.handler?.('depot-C'));
    await waitFor(() => expect(getDepot()).toBe('depot-C'));
  });

  it('a failed re-check changes nothing', async () => {
    h.get.mockResolvedValueOnce({ id: 'u1', assignedDepotId: 'depot-A' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    vi.setSystemTime(new Date('2026-10-26T01:05:00.000Z'));
    h.get.mockRejectedValue(new Error('offline'));
    await act(async () => show('visible'));
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    expect(getDepot()).toBe('depot-A');
    expect(h.refreshNow).not.toHaveBeenCalled();
  });

  it('signing out clears the depot selection so the next account does not inherit it', async () => {
    h.get.mockResolvedValue({ id: 'u1', assignedDepotId: 'depot-A' });
    let auth: ReturnType<typeof useAuth> | null = null;
    render(<AuthProvider><Probe onAuth={(a) => (auth = a)} /></AuthProvider>);
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    expect(getDepot()).toBe('depot-A');
    act(() => (auth as ReturnType<typeof useAuth> | null)?.signOut());
    expect(getDepot()).toBeNull();
  });
});
