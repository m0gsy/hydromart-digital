// @vitest-environment jsdom
//
// PAR-16. `POST /auth/logout/all` was built, guarded and reachable from no screen in the
// app — so the one action a person needs the moment their phone is stolen could only be
// run by hand-crafting an HTTP request. This is the screen that calls it, and these are the
// three things it has to get right:
//
//   1. it lists the devices the server returns, rather than an empty state over a live read
//   2. revoking ONE device posts to that device's id and re-reads the list
//   3. revoking ALL of them signs this device out locally too — the token it is holding was
//      among the ones just revoked, so staying signed in turns every later request into a
//      401 with no explanation
//
// apps/web is gated at 74/81/50/74, not the backend's 98, so a screen can land here with no
// test at all and CI stays green. That is why this file exists rather than being implied.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, put, signOut, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  signOut: vi.fn(),
  toast: vi.fn(),
}));

const SESSIONS = [
  {
    id: 'sess-1',
    createdAt: '2026-08-20T02:00:00.000Z',
    expiresAt: '2026-09-20T02:00:00.000Z',
    ipAddress: '10.1.2.3',
    userAgent: 'Chrome on Android',
  },
  {
    id: 'sess-2',
    createdAt: '2026-08-01T02:00:00.000Z',
    expiresAt: '2026-09-01T02:00:00.000Z',
    ipAddress: null,
    userAgent: null,
  },
];

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, put },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'c1', role: 'CUSTOMER', fullName: 'Budi', phone: '81100000001' },
    ready: true,
    signOut,
  }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import AccountPage from '@/app/account/page';

beforeEach(() => {
  signOut.mockReset();
  toast.mockReset();
  post.mockReset().mockResolvedValue({ message: 'ok' });
  put.mockReset().mockResolvedValue({});
  getCached.mockReset().mockResolvedValue([]);
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/api/v1/sessions')) return Promise.resolve(SESSIONS);
    if (p.includes('/loyalty/me'))
      return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' });
    if (p.includes('gallon-deposit')) return Promise.resolve([]);
    if (p.includes('/profile/notifications')) return Promise.resolve({});
    return Promise.resolve([]);
  });
});

afterEach(() => vi.clearAllMocks());

/** Open the "Perangkat & sesi" sheet the way a person does: by pressing its row. */
async function openDevices() {
  const user = userEvent.setup();
  render(<AccountPage />, { wrapper: LocaleProvider });
  await user.click(await screen.findByText('Perangkat & sesi'));
  return user;
}

describe('/account · devices & sessions (PAR-16)', () => {
  it('lists every device the server returns', async () => {
    await openDevices();
    expect(await screen.findByText('Chrome on Android')).toBeTruthy();
    // A session with no user-agent is still a device somebody can sign in from; dropping it
    // from the list would hide exactly the session worth revoking.
    expect(await screen.findByText('Perangkat tidak dikenali')).toBeTruthy();
  });

  it('revokes one device against that device id', async () => {
    const user = await openDevices();
    const buttons = await screen.findAllByRole('button', { name: 'Keluarkan' });
    await user.click(buttons[0]!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('sess-1');
    expect(String(post.mock.calls[0]![0])).toContain('revoke');
    // The list is re-read, so a revoked device does not linger on screen.
    await waitFor(() =>
      expect(
        get.mock.calls.filter((c) => String(c[0]).includes('/api/v1/sessions')).length,
      ).toBeGreaterThan(1),
    );
  });

  it('asks before signing out everywhere, and does nothing if you say no', async () => {
    const user = await openDevices();
    await user.click(await screen.findByRole('button', { name: 'Keluar dari semua perangkat' }));
    expect(await screen.findByText(/Semua perangkat, termasuk yang ini/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out of every device AND of this one', async () => {
    const user = await openDevices();
    await user.click(await screen.findByRole('button', { name: 'Keluar dari semua perangkat' }));
    // The dialog's own confirm button, not the row that opened it.
    const confirms = await screen.findAllByRole('button', { name: 'Keluar dari semua perangkat' });
    await user.click(confirms[confirms.length - 1]!);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('/auth/logout/all');
    // The whole point: this device's token was revoked server-side, so the app must not go
    // on believing it is signed in.
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});
