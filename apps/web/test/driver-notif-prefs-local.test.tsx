// @vitest-environment jsdom
/*
 * K5.1 (client half) — the courier's notification switches were persisted to the CUSTOMER
 * preference endpoint with a staff account id. Nothing read those rows (staff pushes
 * deliberately ignore a customer's own mutes), and the endpoint is CUSTOMER-only now, so
 * the call would 403 into a `.catch(() => {})` — a switch that says it saved and does not.
 *
 * Until staff preferences exist as their own thing (O6), these are device switches, and the
 * screen says so instead of implying an account-wide setting it cannot make.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, patch, post: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 's-1', role: 'STAFF_DEPOT' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/driver/settings',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/push', () => ({
  getPushState: () => Promise.resolve('unsubscribed'),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  pushSupported: () => true,
  requestPushOnce: vi.fn(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ThemeProvider } from '@/lib/theme-context';
import DriverSettingsPage from '@/app/driver/settings/page';

beforeEach(() => {
  // jsdom has no matchMedia and the theme provider asks for it. Fake the browser API
  // rather than mocking the module that calls it — the module is what this renders.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
  localStorage.clear();
  get.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

const view = () =>
  render(
    <LocaleProvider>
      <ThemeProvider>
        <DriverSettingsPage />
      </ThemeProvider>
    </LocaleProvider>,
  );

describe('K5.1 · courier notification switches', () => {
  it('never writes to the customer preference endpoint', async () => {
    view();
    const toggles = await screen.findAllByRole('switch');
    await userEvent.click(toggles[1]!);
    await waitFor(() => expect(localStorage.getItem('hydromart_driver_notif_prefs')).toBeTruthy());
    expect(patch.mock.calls.filter(([p]) => String(p).includes('notifications'))).toHaveLength(0);
    expect(get.mock.calls.filter(([p]) => String(p).includes('profile/notifications'))).toHaveLength(0);
  });

  it('says the switches are for this device', async () => {
    view();
    expect(await screen.findByText(/berlaku di perangkat ini saja/i)).toBeTruthy();
  });
});
