// @vitest-environment jsdom
/**
 * F5 · signing out has to release the device, not just the session.
 *
 * The FCM registration outlived the account. A phone that signed out kept receiving the
 * previous account's pushes, and the NEXT account was never registered on it either: the
 * endpoint is the same `fcm:<token>` string either way, so the subscribe path deduped
 * against a registration that had already changed hands. Shared handsets — the shift
 * phone at a depot — hit both halves of that in one day.
 *
 * Its own file because it needs the REAL auth-context, while the rest of Fase F mocks it.
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post, unsubscribeFromPush, clearTokens } = vi.hoisted(() => ({
  post: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  clearTokens: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, post, get: vi.fn().mockResolvedValue(null) } };
});
vi.mock('@/lib/push', () => ({ unsubscribeFromPush }));
vi.mock('@/lib/token-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/token-store')>('@/lib/token-store');
  return { ...actual, clearTokens, getRefreshToken: () => 'rt-1', hasTokens: () => true };
});

import { AuthProvider, useAuth } from '@/lib/auth-context';

let signOut: (() => void) | null = null;
function Probe() {
  signOut = useAuth().signOut;
  return null;
}

beforeEach(() => {
  post.mockReset().mockResolvedValue(undefined);
  unsubscribeFromPush.mockReset().mockResolvedValue('unsubscribed');
  clearTokens.mockReset();
  signOut = null;
});
afterEach(() => vi.clearAllMocks());

describe('signOut', () => {
  it('releases the push registration', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(signOut).not.toBeNull());
    signOut!();

    await waitFor(() => expect(unsubscribeFromPush).toHaveBeenCalledTimes(1));
  });

  it('issues the release BEFORE the credential it needs is dropped', async () => {
    const order: string[] = [];
    unsubscribeFromPush.mockImplementation(async () => {
      order.push('unsubscribe');
      return 'unsubscribed';
    });
    clearTokens.mockImplementation(() => order.push('clearTokens'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(signOut).not.toBeNull());
    signOut!();

    await waitFor(() => expect(order).toContain('unsubscribe'));
    expect(order.indexOf('unsubscribe')).toBeLessThan(order.indexOf('clearTokens'));
  });

  it('still signs out when the release fails', async () => {
    unsubscribeFromPush.mockRejectedValue(new Error('no service worker'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(signOut).not.toBeNull());
    expect(() => signOut!()).not.toThrow();

    await waitFor(() => expect(clearTokens).toHaveBeenCalled());
  });
});
